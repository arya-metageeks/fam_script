import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const upgradableContractABI = JSON.parse(fs.readFileSync('./abi/upgradableContract.json', 'utf-8'));
const usdtABI = JSON.parse(fs.readFileSync('./abi/usdt.json', 'utf-8'));

async function mint_domains(fundedWalletPrivateKey:string,domainsCount:number) {

    const USDT_CONTRACT_ADDRESS = process.env.USDT_ADDRESS;
    const TARGET_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
    if (!USDT_CONTRACT_ADDRESS || !TARGET_CONTRACT_ADDRESS) {
        throw new Error("Addresses not provided")
    }
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const wallet = new ethers.Wallet(fundedWalletPrivateKey, provider);

    const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, usdtABI, wallet);
    const targetContract = new ethers.Contract(TARGET_CONTRACT_ADDRESS, upgradableContractABI, wallet);


    for (let i = 0; i < domainsCount; i++) {
        try {
            // 1. Create a new wallet
            const newWallet = ethers.Wallet.createRandom().connect(provider);
            console.log(`New wallet address: ${newWallet.address}`);

            // 2. Send 0.001 ETH to the new wallet
            const ethAmount = ethers.parseEther('0.0001');
            const ethTx = await wallet.sendTransaction({
                to: newWallet.address,
                value: ethAmount
            });
            await ethTx.wait();
            console.log(`Sent 0.001 ETH to ${newWallet.address}`);

            // 3. Send 5 USDT tokens to the new wallet
            const usdtAmount = ethers.parseUnits('5', 6); // Assuming USDT has 6 decimal places
            const usdtTx = await usdtContract.transfer(newWallet.address, usdtAmount);
            await usdtTx.wait();
            console.log(`Sent 5 USDT to ${newWallet.address}`);

            // 4. Approve and call mintDomainWithReferral
            const domain = `domain${Math.floor(Math.random()*1000)}`; // Example domain name
            const referralCode = '6a4b7815'; // Example referral code

            // Approve USDT spending
            //   @ts-ignore
            const approveTx = await usdtContract.connect(newWallet).approve(TARGET_CONTRACT_ADDRESS, usdtAmount);
            await approveTx.wait();
            console.log(`Approved 5 USDT for spending by ${TARGET_CONTRACT_ADDRESS}`);

            // Call mintDomainWithReferral
            //   @ts-ignore

            const mintTx = await targetContract.connect(newWallet).mintDomainWithReferral(domain, referralCode);
            await mintTx.wait();
            console.log(mintTx)
            console.log(`Called mintDomainWithReferral for ${domain}`);

        } catch (error) {
            console.error(`Error in iteration ${i}:`, error);
        }
    }
}
