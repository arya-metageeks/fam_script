import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import express, { Request, Response } from 'express';
import { formatDistanceToNow } from 'date-fns';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import { uniqueNamesGenerator, Config, names } from 'unique-names-generator';

const config: Config = {
  dictionaries: [names]
}
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.DB_NAME });

const walletSchema = new mongoose.Schema({
  privateKey: String,
  publicKey: String,
  fundedWalletPublicKey: String,
  mintTransactionHash: String,
  domain: String,
  created_at: Date
});

const Wallet = mongoose.model('Wallet', walletSchema);

const upgradableContractABI = JSON.parse(fs.readFileSync('./abi/upgradableContract.json', 'utf-8'));
const usdtABI = JSON.parse(fs.readFileSync('./abi/usdt.json', 'utf-8'));
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const USDT_CONTRACT_ADDRESS = process.env.USDT_ADDRESS;
const TARGET_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!USDT_CONTRACT_ADDRESS || !TARGET_CONTRACT_ADDRESS) {
  throw new Error("Addresses not provided");
}



async function mint_domains(fundedWalletPrivateKey: string, domainsCount: number, referralCode: string) {
  const wallet = new ethers.Wallet(fundedWalletPrivateKey, provider);

  const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS!, usdtABI, wallet);
  const targetContract = new ethers.Contract(TARGET_CONTRACT_ADDRESS!, upgradableContractABI, wallet);

  for (let i = 0; i < domainsCount; i++) {
    try {

      const domain = uniqueNamesGenerator(config);
      const usdtAmount = ethers.parseUnits('5', 6);


      const newWallet = ethers.Wallet.createRandom().connect(provider);
      // const newWallet = new ethers.Wallet(process.env.TARGET_PRIVATE_KEY!, provider);
      console.log(`New wallet address: ${newWallet.address}`);


      // Get current gas price
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice!
        console.log({feeData})




      // Check USDT balance before proceeding

      const usdtBalance = await usdtContract.balanceOf(wallet.address);
      console.log({usdtBalanceInFundedWallet:usdtBalance})
      if (usdtBalance < (ethers.parseUnits('5', 6))) {
        console.log("Insufficient USDT balance. Stopping minting process.");
        return;
      }





      // Estimate gas for approve transaction
      // @ts-ignore
      const approveGasEstimate = await usdtContract.connect(newWallet).approve.estimateGas(TARGET_CONTRACT_ADDRESS, usdtAmount);
      
      const totalGasBuffer = approveGasEstimate * BigInt(5)
      const requiredEth = totalGasBuffer * gasPrice;
      console.log({ requiredEth:ethers.formatEther(requiredEth) })

      const approvalEthTx = await wallet.sendTransaction({
        to: newWallet.address,
        value: requiredEth
      });
      await approvalEthTx.wait();
      console.log(`Sent ${ethers.formatEther(requiredEth)} ETH to ${newWallet.address}`);



      // @ts-ignore
      const approveTx = await usdtContract.connect(newWallet).approve(TARGET_CONTRACT_ADDRESS, usdtAmount);
      await approveTx.wait();
      console.log(`Approved 5 USDT for spending by ${TARGET_CONTRACT_ADDRESS}`);

      

      const usdtTx = await usdtContract.transfer(newWallet.address, usdtAmount);
      await usdtTx.wait();
      console.log(`Sent 5 USDT to ${newWallet.address}`);

      // @ts-ignore
      // const mintGasEstimate = await targetContract.connect(newWallet).mintDomainWithReferral.estimateGas(domain, referralCode);
      // console.log({ mintGasEstimate })









      // const requiredEthForMinting = mintGasEstimate * gasPrice;
      // console.log({ requiredEthForMinting:ethers.formatEther(requiredEthForMinting) })


      // @ts-ignore
      const mintTx = await targetContract.connect(newWallet).mintDomainWithReferral(domain, referralCode);
      const receipt = await mintTx.wait();
      console.log(`Called mintDomainWithReferral for ${domain}`);

      // Save wallet data to MongoDB
      const walletData = new Wallet({
        privateKey: newWallet.privateKey,
        publicKey: newWallet.address,
        fundedWalletPublicKey: wallet.address.toLowerCase(),
        mintTransactionHash: receipt.hash,
        created_at: new Date(),
        domain
      });
      await walletData.save();
      console.log(`Saved wallet data to MongoDB`);

    } catch (error) {
      console.error(`Error in iteration ${i}:`, error);
    }
  }
}


app.post('/mint', async (req, res) => {
  const { private_key, domain_count, referral_code } = req.body;
  try {
    const wallet = new ethers.Wallet(private_key, provider);

    const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
    const usdtBalance = await usdtContract.balanceOf(wallet.address);
    const maxMintCount = Math.floor(Number(usdtBalance) / Number(ethers.parseUnits('5', 6)))
    if(domain_count>maxMintCount){
      res.send({message:"Error:You can mint at max"+maxMintCount + " domains"})
      return
    }
    res.json({ message: 'Minting started successfully! Please link below to see mint data live!', publicKey: wallet.address });
    await mint_domains(private_key, parseInt(domain_count), referral_code);
  } catch (error: any) {
    console.error('Error during minting:', error);
    res.status(500).json({ message: error.message || 'An error occurred during minting' });
  }
});

app.get('/', (req, res) => {
  const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Domain Minting</title>
          <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
              form { display: flex; flex-direction: column; }
              input, button { margin: 10px 0; padding: 10px; }
              #loader { display: none; text-align: center; }
          </style>
      </head>
      <body>
          <h1>Domain Minting</h1>
          <form id="mintForm">
              <input type="password" id="privateKey" name="privateKey" placeholder="Private Key" required>
              <input type="text" id="referralCode" name="referralCode" placeholder="Referral Code" required>
              <input type="number" id="domainCount" name="domainCount" placeholder="Domain Count" required>
              <button type="submit">Start Minting</button>
          </form>
          <div id="loader">Minting in progress... Please wait.</div>
          <div id="result">
          <a href="/">View minting data</a>
          </div>
          <script>
              document.getElementById('mintForm').addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const privateKey = document.getElementById('privateKey').value;
                  const domainCount = document.getElementById('domainCount').value;
                  const referralCode = document.getElementById('referralCode').value;
                  document.getElementById('loader').style.display = 'block';
                  try {
                      const response = await fetch('/mint', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ private_key: privateKey, domain_count: domainCount, referral_code:referralCode })
                      });
                      const result = await response.json();
                      alert(result.message);
                  } catch (error) {
                      alert('An error occurred during minting.');
                  } finally {
                      document.getElementById('loader').style.display = 'none';
                  }
              });
          </script>
      </body>
      </html>
    `;
  res.send(html);
});
// @ts-ignore
app.get("/data", async (req, res) => {

  try {
    const entries = await Wallet.find({});
    console.log(entries)
    if (entries.length === 0) {
      return res.send(`<body>
            <h1>No entries found!Page is going to refresh in 5 seconds <a href="/">MINT</a></h1>
            <script>
                setInterval(() => {
                    location.reload();
                }, 5000);
            </script>
            <body>`);
    }

    // Create HTML table with the data
    const tableRows = entries.map((entry, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${entry.domain}</td>
          <td title="${entry.publicKey?.slice(0, 12)}">${entry.publicKey?.slice(0, 12)}</td>
          <td title="${entry.fundedWalletPublicKey?.slice(0, 12)}">${entry.fundedWalletPublicKey?.slice(0, 12)}</td>
          <td><a href="${process.env.EXPLORER_URL}/tx/${entry.mintTransactionHash}" target="_blank">View Transaction</a></td>
          <td>${formatDistanceToNow(new Date(entry.created_at?.toDateString()!), { includeSeconds: true })}</td>
        </tr>
      `).join('');

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Minting Data</title>

            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background-color: #f2f2f2; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                h1 { color: #333; }
            </style>
        </head>
        <body>
            <h1>Minting Data</h1>
            <h5>page refresh every 10 sec</h5>
            
            <table>
                <thead>
                    <tr>

                        <th>No</th>
                        <th>Domain</th>
                        <th>Minted Wallet Public Key</th>
                        <th>Fund Wallet Public Key</th>
                        <th>Mint Transaction</th>
                        <th>Minted at</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </body>
        <script>
                setInterval(() => {
                    location.reload();
                }, 10000);
            </script>
        </html>
      `;

    res.send(html);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).send('<h1>An error occurred while fetching data</h1>');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});