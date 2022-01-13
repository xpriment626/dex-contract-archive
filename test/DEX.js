const { web3, expectRevert } = require("@openzeppelin/test-helpers/src/setup");

const DEX = artifacts.require("DEX");
const Dai = artifacts.require("mocks/Dai.sol");
const Uni = artifacts.require("mocks/Uni.sol");
const Mkr = artifacts.require("mocks/Maker.sol");
const Aave = artifacts.require("mocks/Aave.sol");

const LIMIT = {
    BUY: 0,
    SELL: 1,
};

contract("Decentralised Exchange", (accounts) => {
    let contract, dai, uni, mkr, aave;
    let address;
    const [trader1, trader2] = [accounts[1], accounts[2]];
    const [DAI, UNI, MKR, AAVE] = ["DAI", "UNI", "MKR", "AAVE"].map((ticker) =>
        web3.utils.fromAscii(ticker)
    );

    beforeEach(async () => {
        [dai, uni, mkr, aave] = await Promise.all([
            Dai.new(),
            Uni.new(),
            Mkr.new(),
            Aave.new(),
        ]);
        contract = await DEX.new();
        address = await contract.address;

        await Promise.all([
            contract.addToken(DAI, dai.address),
            contract.addToken(UNI, uni.address),
            contract.addToken(MKR, mkr.address),
            contract.addToken(AAVE, aave.address),
        ]);

        const amount = web3.utils.toWei("1000");
        const seedTokenBalance = async (token, trader) => {
            await token.faucet(trader, amount);
            await token.approve(contract.address, amount, { from: trader });
        };
        await Promise.all(
            [dai, uni, mkr, aave].map((token) =>
                seedTokenBalance(token, trader1)
            )
        );
        await Promise.all(
            [dai, uni, mkr, aave].map((token) =>
                seedTokenBalance(token, trader2)
            )
        );
    });
    describe("Deployment:", () => {
        it("Should deploy successfuly", async () => {
            assert(address != null, "failed to deploy");
            assert(address != undefined, "failed to deploy");
            assert(address != 0x0, "failed to deploy");
            console.log(
                "Success:",
                `Successfully deployed contract ${address}`
            );
        });
    });
    describe("DEX Wallet:", () => {
        it("Should deposit tokens", async () => {
            const amount = web3.utils.toWei("100");
            await contract.deposit(DAI, amount, { from: trader1 });
            const balance = await contract.traderBalances(trader1, DAI);
            assert(balance.toString() === amount);
        });
        it("Should revert if token does not exist", async () => {
            try {
                await contract.deposit(
                    web3.utils.fromAscii("VAGINE"),
                    web3.utils.toWei("100"),
                    { from: trader1 }
                );
            } catch (e) {
                assert(e.message.includes("Token does not exist"));
            }
        });
        it("Should withdraw tokens", async () => {
            const amount = web3.utils.toWei("100");

            await contract.deposit(DAI, amount, { from: trader1 });
            await contract.withdraw(DAI, amount, { from: trader1 });

            const walletBalance = await contract.traderBalances(trader1, DAI);
            const traderDai = await dai.balanceOf(trader1);
            assert(walletBalance.isZero());
            assert(traderDai.toString() === web3.utils.toWei("1000"));
        });
        it("Should revert if token does not exist", async () => {
            try {
                await contract.withdraw(
                    web3.utils.fromAscii("VAGINE"),
                    web3.utils.toWei("100"),
                    { from: trader1 }
                );
            } catch (e) {
                assert(e.message.includes("Token does not exist"));
            }
        });
        it("Should revert if balance is too low", async () => {
            try {
                const amount = web3.utils.toWei("100");
                const falseAmount = web3.utils.toWei("99999");
                await contract.deposit(DAI, amount, { from: trader1 });
                await contract.withdraw(DAI, falseAmount);
            } catch (e) {
                assert(e.message.includes("insufficient balance"));
            }
        });
    });
    describe("Limit Orders:", () => {
        it("Should create limit orders", async () => {
            const capital = web3.utils.toWei("500");
            const trade = web3.utils.toWei("100");

            await contract.deposit(DAI, capital, { from: trader1 });
            await contract.limitOrder(UNI, 5, trade, LIMIT.BUY, {
                from: trader1,
            });

            let buyOrders = await contract.getOrders(UNI, LIMIT.BUY);
            let sellOrders = await contract.getOrders(UNI, LIMIT.SELL);
            assert(buyOrders.length === 1);
            assert(buyOrders[0].trader === trader1);
            assert(sellOrders.length === 0);

            console.log("Limit order created by:", trader1);
        });
    });
    describe("Limit Order Fails:", () => {
        it("Should revert if not enough Dai", async () => {
            const capital = web3.utils.toWei("500");
            const trade = web3.utils.toWei("100");
            try {
                await contract.deposit(DAI, capital, { from: trader1 });
                await contract.limitOrder(UNI, 9, trade, LIMIT.BUY, {
                    from: trader1,
                });
            } catch (e) {
                assert(e.message.includes("not enough Dai"));
            }
        });
        it("Should revert if DAI order is placed", async () => {
            const capital = web3.utils.toWei("500");
            const trade = web3.utils.toWei("100");
            try {
                await contract.deposit(DAI, capital, { from: trader1 });
                await contract.limitOrder(DAI, 9, trade, LIMIT.BUY, {
                    from: trader1,
                });
            } catch (e) {
                assert(e.message.includes("Cannot trade stablecoins"));
            }
        });
        it("Should revert if token does not exist", async () => {
            const breaker = web3.utils.fromAscii("VAGINE");
            const capital = web3.utils.toWei("500");
            const trade = web3.utils.toWei("100");
            try {
                await contract.deposit(DAI, capital, { from: trader1 });
                await contract.limitOrder(breaker, 9, trade, LIMIT.BUY, {
                    from: trader1,
                });
            } catch (e) {
                assert(e.message.includes("Token does not exist"));
            }
        });
    });
    describe("Market Orders:", () => {
        it("Should create market orders", async () => {
            await contract.deposit(DAI, web3.utils.toWei("100"), {
                from: trader1,
            });

            await contract.limitOrder(
                AAVE,
                web3.utils.toWei("10"),
                10,
                LIMIT.BUY,
                { from: trader1 }
            );

            await contract.deposit(AAVE, web3.utils.toWei("100"), {
                from: trader2,
            });

            await contract.marketOrder(
                AAVE,
                web3.utils.toWei("5"),
                LIMIT.SELL,
                { from: trader2 }
            );

            const balances = await Promise.all([
                contract.traderBalances(trader1, DAI),
                contract.traderBalances(trader1, AAVE),
                contract.traderBalances(trader2, DAI),
                contract.traderBalances(trader2, AAVE),
            ]);
            const orders = await contract.getOrders(AAVE, LIMIT.BUY);
            assert(orders.length === 1);
            assert((orders[0].filled = web3.utils.toWei("5")));
            assert(balances[0].toString() === web3.utils.toWei("50"));
            assert(balances[1].toString() === web3.utils.toWei("5"));
            assert(balances[2].toString() === web3.utils.toWei("50"));
            assert(balances[3].toString() === web3.utils.toWei("95"));
            console.log("Market order created by", trader2);
        });
    });
    describe("Market Order Fails:", () => {
        it("Should revert if balance is too low", async () => {
            const capital = web3.utils.toWei("500");
            const breaker = web3.utils.toWei("9999");
            try {
                await contract.deposit(AAVE, capital, { from: trader2 });
                await contract.marketOrder(AAVE, breaker, LIMIT.SELL, {
                    from: trader2,
                });
            } catch (e) {
                assert(e.message.includes("insufficient token balance"));
            }
        });
        it("Should revert if order placed is Dai", async () => {
            const capital = web3.utils.toWei("500");
            const breaker = web3.utils.toWei("9999");
            try {
                await contract.deposit(DAI, capital, { from: trader2 });
                await contract.marketOrder(DAI, breaker, LIMIT.SELL, {
                    from: trader2,
                });
            } catch (e) {
                assert(e.message.includes("Cannot trade stablecoins"));
            }
        });
        it("Should revert if token does not exist", async () => {
            const capital = web3.utils.toWei("500");
            const breaker = web3.utils.fromAscii("VAGINE");
            try {
                await contract.deposit(DAI, capital, { from: trader2 });
                await contract.marketOrder(breaker, capital, LIMIT.SELL, {
                    from: trader2,
                });
            } catch (e) {
                assert(e.message.includes("Token does not exist"));
            }
        });
    });
});
