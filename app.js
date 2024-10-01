"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const date_fns_1 = require("date-fns");
const mongoose_1 = __importDefault(require("mongoose"));
const body_parser_1 = __importDefault(require("body-parser"));
const unique_names_generator_1 = require("unique-names-generator");
const config = {
    dictionaries: [unique_names_generator_1.names]
};
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
mongoose_1.default.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const walletSchema = new mongoose_1.default.Schema({
    privateKey: String,
    publicKey: String,
    fundedWalletPublicKey: String,
    mintTransactionHash: String,
    domain: String,
    created_at: Date
});
const Wallet = mongoose_1.default.model('Wallet', walletSchema);
const upgradableContractABI = JSON.parse(fs_1.default.readFileSync('./abi/upgradableContract.json', 'utf-8'));
const usdtABI = JSON.parse(fs_1.default.readFileSync('./abi/usdt.json', 'utf-8'));
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.RPC_URL);
const USDT_CONTRACT_ADDRESS = process.env.USDT_ADDRESS;
const TARGET_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!USDT_CONTRACT_ADDRESS || !TARGET_CONTRACT_ADDRESS) {
    throw new Error("Addresses not provided");
}
function mint_domains(fundedWalletPrivateKey, domainsCount, referralCode) {
    return __awaiter(this, void 0, void 0, function* () {
        const wallet = new ethers_1.ethers.Wallet(fundedWalletPrivateKey, provider);
        const usdtContract = new ethers_1.ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
        const targetContract = new ethers_1.ethers.Contract(TARGET_CONTRACT_ADDRESS, upgradableContractABI, wallet);
        for (let i = 0; i < domainsCount; i++) {
            try {
                const domain = (0, unique_names_generator_1.uniqueNamesGenerator)(config);
                const usdtAmount = ethers_1.ethers.parseUnits('5', 6);
                const newWallet = ethers_1.ethers.Wallet.createRandom().connect(provider);
                // const newWallet = new ethers.Wallet(process.env.TARGET_PRIVATE_KEY!, provider);
                console.log(`New wallet address: ${newWallet.address}`);
                // Get current gas price
                const feeData = yield provider.getFeeData();
                const gasPrice = feeData.gasPrice;
                console.log({ feeData });
                // Check USDT balance before proceeding
                const usdtBalance = yield usdtContract.balanceOf(wallet.address);
                console.log({ usdtBalanceInFundedWallet: usdtBalance });
                if (usdtBalance < (ethers_1.ethers.parseUnits('5', 6))) {
                    console.log("Insufficient USDT balance. Stopping minting process.");
                    return;
                }
                // Estimate gas for approve transaction
                // @ts-ignore
                const approveGasEstimate = yield usdtContract.connect(newWallet).approve.estimateGas(TARGET_CONTRACT_ADDRESS, usdtAmount);
                const totalGasBuffer = approveGasEstimate * BigInt(5);
                const requiredEth = totalGasBuffer * gasPrice;
                console.log({ requiredEth: ethers_1.ethers.formatEther(requiredEth) });
                const approvalEthTx = yield wallet.sendTransaction({
                    to: newWallet.address,
                    value: requiredEth
                });
                yield approvalEthTx.wait();
                console.log(`Sent ${ethers_1.ethers.formatEther(requiredEth)} ETH to ${newWallet.address}`);
                // @ts-ignore
                const approveTx = yield usdtContract.connect(newWallet).approve(TARGET_CONTRACT_ADDRESS, usdtAmount);
                yield approveTx.wait();
                console.log(`Approved 5 USDT for spending by ${TARGET_CONTRACT_ADDRESS}`);
                const usdtTx = yield usdtContract.transfer(newWallet.address, usdtAmount);
                yield usdtTx.wait();
                console.log(`Sent 5 USDT to ${newWallet.address}`);
                // @ts-ignore
                // const mintGasEstimate = await targetContract.connect(newWallet).mintDomainWithReferral.estimateGas(domain, referralCode);
                // console.log({ mintGasEstimate })
                // const requiredEthForMinting = mintGasEstimate * gasPrice;
                // console.log({ requiredEthForMinting:ethers.formatEther(requiredEthForMinting) })
                // @ts-ignore
                const mintTx = yield targetContract.connect(newWallet).mintDomainWithReferral(domain, referralCode);
                const receipt = yield mintTx.wait();
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
                yield walletData.save();
                console.log(`Saved wallet data to MongoDB`);
            }
            catch (error) {
                console.error(`Error in iteration ${i}:`, error);
            }
        }
    });
}
app.post('/mint', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { private_key, domain_count, referral_code } = req.body;
    try {
        const wallet = new ethers_1.ethers.Wallet(private_key, provider);
        const usdtContract = new ethers_1.ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
        const usdtBalance = yield usdtContract.balanceOf(wallet.address);
        const maxMintCount = Math.floor(Number(usdtBalance) / Number(ethers_1.ethers.parseUnits('5', 6)));
        if (domain_count > maxMintCount) {
            res.send({ message: "Error:You can mint at max" + maxMintCount + " domains" });
            return;
        }
        res.json({ message: 'Minting started successfully! Please link below to see mint data live!', publicKey: wallet.address });
        yield mint_domains(private_key, parseInt(domain_count), referral_code);
    }
    catch (error) {
        console.error('Error during minting:', error);
        res.status(500).json({ message: error.message || 'An error occurred during minting' });
    }
}));
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
app.get("/data", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const entries = yield Wallet.find({});
        console.log(entries);
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
        const tableRows = entries.map((entry, index) => {
            var _a, _b, _c, _d, _e;
            return `
        <tr>
          <td>${index + 1}</td>
          <td>${entry.domain}</td>
          <td title="${(_a = entry.publicKey) === null || _a === void 0 ? void 0 : _a.slice(0, 12)}">${(_b = entry.publicKey) === null || _b === void 0 ? void 0 : _b.slice(0, 12)}</td>
          <td title="${(_c = entry.fundedWalletPublicKey) === null || _c === void 0 ? void 0 : _c.slice(0, 12)}">${(_d = entry.fundedWalletPublicKey) === null || _d === void 0 ? void 0 : _d.slice(0, 12)}</td>
          <td><a href="${process.env.EXPLORER_URL}/tx/${entry.mintTransactionHash}" target="_blank">View Transaction</a></td>
          <td>${(0, date_fns_1.formatDistanceToNow)(new Date((_e = entry.created_at) === null || _e === void 0 ? void 0 : _e.toDateString()), { includeSeconds: true })}</td>
        </tr>
      `;
        }).join('');
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
    }
    catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('<h1>An error occurred while fetching data</h1>');
    }
}));
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
