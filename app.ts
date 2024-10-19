import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import express, { Request, Response } from 'express';
import { format, formatDistanceToNow } from 'date-fns';
import mongoose from 'mongoose'
import { Config, names } from 'unique-names-generator';
import multer from 'multer';
import { parse } from 'csv-parse';
import axios from 'axios';

const config: Config = {
  dictionaries: [names]
}
dotenv.config();
const BUFFERED_ETH_MULTIPLIER = Number(process.env.BUFFERED_ETH_MULTIPLIER) || 10
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.DB_NAME });

const walletSchema = new mongoose.Schema({
  privateKey: String,
  publicKey: String,
  fundedWalletPublicKey: String,
  mintTransactionHash: String,
  domain: String,
  created_at: Date,
  status: String
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

// Set up multer for file upload
const upload = multer({ dest: 'uploads/' });

const serverInstance = axios.create({
  baseURL: process.env.SERVER_URL
})
async function createUser({
  domain,
  image,
  hash,
  walletAddress,
  referralCode
}:
  {
    domain: string,
    image: string,
    hash: string,
    walletAddress: string,
    referralCode: string
  }
) {
  const bodyContent = {
    "domainAddress": domain,
    "image": image,
    "password": walletAddress,
    "hashCode": hash,
    "walletAddress": walletAddress,
    "referralCode": referralCode
  }

  const response = await serverInstance.post("/user/signUpDomain", bodyContent);
  console.log(response.data);

}
// Function to parse CSV file
function parseCSV(filePath: string): Promise<{ domain: string; pfp: string }[]> {
  return new Promise((resolve, reject) => {
    const results: { domain: string; pfp: string }[] = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}
function addFamSuffix(str:string) {
  if(!str){
    return str
  }
  if (!str.endsWith('.fam')) {
      return str + '.fam';  
  }
  return str;  
}

async function mint_domains(fundedWalletPrivateKey: string, referralCode: string, csvData: { domain: string; pfp: string }[]) {
  const wallet = new ethers.Wallet(fundedWalletPrivateKey, provider);

  const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS!, usdtABI, wallet);
  const targetContract = new ethers.Contract(TARGET_CONTRACT_ADDRESS!, upgradableContractABI, wallet);
  for (let i = 0; i < csvData.length; i++) {
    const csvRow = csvData[i];
    try {
      const domain = addFamSuffix(csvRow?.domain)
      const pfp = csvRow?.pfp
      if (!domain || !pfp) {
        return;
      }
      console.log("starting minting for domain:", domain)
      const usdtAmount = ethers.parseUnits('5', 6);

      const newWallet = ethers.Wallet.createRandom().connect(provider);
      console.log(`New wallet address: ${newWallet.address}`);

      const walletData = new Wallet({
        privateKey: newWallet.privateKey,
        publicKey: newWallet.address,
        fundedWalletPublicKey: wallet.address.toLowerCase(),
        created_at: Date.now(),
        domain,
        status: "pending"
      });
      await walletData.save()
      // Get current gas price
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice!
      console.log({ feeData })

      // Check USDT balance before proceeding
      const usdtBalance = await usdtContract.balanceOf(wallet.address);
      console.log({ usdtBalanceInFundedWallet: usdtBalance })
      if (usdtBalance < (ethers.parseUnits('5', 6))) {
        console.log("Insufficient USDT balance. Stopping minting process.");
        return;
      }

      // Estimate gas for approve transaction
      // @ts-ignore
      const approveGasEstimate = await usdtContract.connect(newWallet).approve.estimateGas(TARGET_CONTRACT_ADDRESS, usdtAmount);

      const totalGasBuffer = approveGasEstimate * BigInt(BUFFERED_ETH_MULTIPLIER)
      const requiredEth = totalGasBuffer * gasPrice;
      console.log({ requiredEth: ethers.formatEther(requiredEth) })

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
      const mintTx = await targetContract.connect(newWallet).mintDomainWithReferral(domain, referralCode);
      const receipt = await mintTx.wait();
      console.log(`Called mintDomainWithReferral for ${domain}`);

      // Save wallet data to MongoDB
      walletData.mintTransactionHash = receipt.hash,
        walletData.status = "success"
      await walletData.save();
      console.log(`Saved wallet data to MongoDB`);
      await createUser({
        domain,
        image: pfp,
        hash: receipt.hash,
        walletAddress: newWallet.address,
        referralCode
      })

    } catch (error) {
      console.error(`Error in iteration ${csvRow}:`, error);
    }
    
  }
}

app.post('/mint', upload.single('csvFile'), async (req, res) => {
  try {
    const csvFile = req.file;
    const private_key = req.body.private_key;
    const referral_code = req.body.referral_code;
    let csvData: { domain: string; pfp: string }[] = [];
    if (csvFile) {
      csvData = await parseCSV(csvFile.path);
    }
    console.log({ private_key, referral_code, csvData })

    const wallet = new ethers.Wallet(private_key, provider);

    const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
    const usdtBalance = await usdtContract.balanceOf(wallet.address);
    const maxMintCount = Math.floor(Number(usdtBalance) / Number(ethers.parseUnits('5', 6)))
    if (!Array.isArray(csvData) || csvData.length == 0)
      if (csvData.length > maxMintCount) {
        res.send({ message: "Error: You can mint at max " + maxMintCount + " domains" })
        return
      }



    res.json({ message: 'Minting started successfully! Please link below to see mint data live!', publicKey: wallet.address });
    await mint_domains(private_key, referral_code, csvData);

    // Delete the temporary CSV file
    if (csvFile) {
      fs.unlinkSync(csvFile.path);
    }
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
          <form id="mintForm" enctype="multipart/form-data">
              <input type="password" id="private_key" name="private_key" placeholder="Private Key" required>
              <input type="text" id="referral_code" name="referral_code" placeholder="Referral Code" required>
              <input type="file" id="csvFile" name="csvFile" accept=".csv">
              <button type="submit">Start Minting</button>
          </form>
          <div id="loader">Minting in progress... Please wait.</div>
          <div id="result">
          <a href="/data">View minting data</a>
          </div>
          <script>
              document.getElementById('mintForm').addEventListener('submit', async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  document.getElementById('loader').style.display = 'block';
                  try {
                      const response = await fetch('/mint', {
                          method: 'POST',
                          body: formData
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
// @ts-expect-error idk
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
          <td>${entry.status}</td>
          <td><a href="${process.env.EXPLORER_URL}/tx/${entry.mintTransactionHash}" target="_blank">View Transaction</a></td>
          <td>${format(new Date(entry.created_at?.toDateString()!), "HH:mm dd MMM yyyy")}</td>
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
                        <th>Status</th>
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

app.listen(port, async () => {
  console.log(`Server running at http://localhost:${port}`);
  const files = await fs.readdirSync("uploads")
  files.forEach(file => {
    if (!file.includes("gitkeep")) {
      fs.unlinkSync(`uploads/${file}`)
    }
  })

});
