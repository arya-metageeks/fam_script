import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
const port = process.env.PORT ||3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/minting_db',{dbName:"FamProtocolData"});

const walletSchema = new mongoose.Schema({
  privateKey: String,
  publicKey: String,
  fundedWalletPublicKey: String,
  mintTransactionHash: String,
});

const Wallet = mongoose.model('Wallet', walletSchema);

const upgradableContractABI = JSON.parse(fs.readFileSync('./abi/upgradableContract.json', 'utf-8'));
const usdtABI = JSON.parse(fs.readFileSync('./abi/usdt.json', 'utf-8'));

async function mint_domains(fundedWalletPrivateKey: string, domainsCount: number) {
  const USDT_CONTRACT_ADDRESS = process.env.USDT_ADDRESS;
  const TARGET_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!USDT_CONTRACT_ADDRESS || !TARGET_CONTRACT_ADDRESS) {
    throw new Error("Addresses not provided");
  }
  const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
  const wallet = new ethers.Wallet(fundedWalletPrivateKey, provider);

  const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
  const targetContract = new ethers.Contract(TARGET_CONTRACT_ADDRESS, upgradableContractABI, wallet);

  for (let i = 0; i < domainsCount; i++) {
    try {
      const newWallet = ethers.Wallet.createRandom().connect(provider);
      console.log(`New wallet address: ${newWallet.address}`);

      const ethAmount = ethers.parseEther('0.0001');
      const ethTx = await wallet.sendTransaction({
        to: newWallet.address,
        value: ethAmount
      });
      await ethTx.wait();
      console.log(`Sent 0.001 ETH to ${newWallet.address}`);

      const usdtAmount = ethers.parseUnits('5', 6);
      const usdtTx = await usdtContract.transfer(newWallet.address, usdtAmount);
      await usdtTx.wait();
      console.log(`Sent 5 USDT to ${newWallet.address}`);

      const domain = `domain${Math.floor(Math.random()*1000)}`;
      const referralCode = '6a4b7815';
      //@ts-ignore
      const approveTx = await usdtContract.connect(newWallet).approve(TARGET_CONTRACT_ADDRESS, usdtAmount);
      await approveTx.wait();
      console.log(`Approved 5 USDT for spending by ${TARGET_CONTRACT_ADDRESS}`);

      //@ts-ignore
      const mintTx = await targetContract.connect(newWallet).mintDomainWithReferral(domain, referralCode);
      const receipt = await mintTx.wait();
      console.log(`Called mintDomainWithReferral for ${domain}`);

      // Save wallet data to MongoDB
      const walletData = new Wallet({
        privateKey: newWallet.privateKey,
        publicKey: newWallet.address,
        fundedWalletPublicKey: wallet.address,
        mintTransactionHash: receipt.hash,
      });
      await walletData.save();
      console.log(`Saved wallet data to MongoDB`);

    } catch (error) {
      console.error(`Error in iteration ${i}:`, error);
    }
  }
}

app.get('/', (req:Request, res:Response) => {
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
            <input type="text" id="privateKey" name="privateKey" placeholder="Private Key" required>
            <input type="number" id="domainCount" name="domainCount" placeholder="Domain Count" required>
            <button type="submit">Start Minting</button>
        </form>
        <div id="loader">Minting in progress... Please wait.</div>
        <script>
            document.getElementById('mintForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const privateKey = document.getElementById('privateKey').value;
                const domainCount = document.getElementById('domainCount').value;
                document.getElementById('loader').style.display = 'block';
                try {
                    const response = await fetch('/mint', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ private_key: privateKey, domain_count: domainCount })
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

app.post('/mint', async (req:Request, res:Response) => {
  const { private_key, domain_count } = req.body;
  try {
    await mint_domains(private_key, parseInt(domain_count));
    res.json({ message: 'Minting completed successfully' });
  } catch (error) {
    console.error('Error during minting:', error);
    res.status(500).json({ message: 'An error occurred during minting' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});