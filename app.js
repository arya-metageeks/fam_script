const { ethers } = require('ethers');
require('dotenv').config();
const usdtAbi = require("./abi/usdt.json");
const mintingAbi = require("./abi/upgradableContract.json");

async function main() {
    const provider = new ethers.providers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    
    const usdtContractAddress = '0x7c63AdBe006ae7870C74DEf5578418984c6dC04C';
    const usdtContract = new ethers.Contract(usdtContractAddress, usdtAbi, wallet);

    
    const mintingContractAddress = '0x676b4a82C1e078D3E24F61c7B3aeAd7e6CAbC8EB';

    
    function generateRandomDomain() {
        return Math.random().toString(36).substring(2, 15);
    }

    
    for (let i = 0; i < 1; i++) {
        const randomWallet = ethers.Wallet.createRandom();
        const randomWalletConnected = randomWallet.connect(provider);
        const tx1 = await wallet.sendTransaction({
            to: randomWallet.address,
            value: ethers.utils.parseEther("0.01") 
        });
        await tx1.wait();
        console.log("ETH sent");

        
        const tx2 = await usdtContract.transfer(randomWallet.address, ethers.utils.parseUnits('5', 6)); 
        await tx2.wait();
        console.log("USDT sent");

        const ethBalanceAfter = await provider.getBalance(randomWallet.address);
        const usdtBalanceAfter = await usdtContract.balanceOf(randomWallet.address);
        console.log(`ETH balance after: ${ethers.utils.formatEther(ethBalanceAfter)}`);
        console.log(`USDT balance after: ${ethers.utils.formatUnits(usdtBalanceAfter, 6)}`);

        console.log("Waiting for 5 seconds")
        await new Promise((resolve)=>{
            setTimeout(()=>{
                resolve()
            },10000)
        })
        console.log("Taking approval")
        
        const usdtContractWithRandomWallet = new ethers.Contract(usdtContractAddress, usdtAbi,randomWalletConnected);
        const approvalTx = await usdtContractWithRandomWallet.approve(mintingContractAddress, ethers.utils.parseUnits('5', 6),{gasLimit:100000000});
        await approvalTx.wait();
        console.log("Got approval");

        
        const mintingContractWithRandomWallet = new ethers.Contract(mintingContractAddress, mintingAbi, randomWalletConnected);
        const domain = generateRandomDomain();
        const mintTx = await mintingContractWithRandomWallet.mintDomainWithReferral(domain, '9304e8db');
        await mintTx.wait();

        console.log(`Minted domain ${domain} with wallet ${randomWallet.address}`);

        
    }
}

main().catch(console.error);