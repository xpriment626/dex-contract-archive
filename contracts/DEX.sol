// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/math/SafeMath.sol';

contract DEX {

    using SafeMath for uint;

    enum Limit {
        BUY,
        SELL
    }

    struct Token {
        bytes32 ticker;
        address tokenAddress;
    }

    struct Order {
        uint256 id;
        address trader;
        Limit side;
        bytes32 ticker;
        uint256 amount;
        uint256 filled;
        uint256 price;
        uint256 date;
    }

    mapping(bytes32 => Token) public tokens;
    mapping(address => mapping(bytes32 => uint256)) public traderBalances;
    mapping(bytes32 => mapping(uint256 => Order[])) public orderBook;
    bytes32[] public tokenList;
    address public admin;
    uint256 nextOrderId;
    uint256 nextTradeId;
    bytes32 constant DAI = bytes32("DAI");

    event NewTrade (
        uint256 tradeId,
        uint256 orderId,
        bytes32 indexed ticker,
        address indexed trader1,
        address indexed trader2,
        uint256 amount,
        uint256 price,
        uint256 date
    );

    constructor() {
        admin = msg.sender;
    }

    function getOrders(
        bytes32 _ticker, 
        Limit _side) external view returns(Order[] memory) {
            return orderBook[_ticker][uint(_side)];
    }

    function getTokens() external view returns(Token[] memory) {
      Token[] memory _tokens = new Token[](tokenList.length);
      for (uint i = 0; i < tokenList.length; i++) {
        _tokens[i] = Token(
          tokens[tokenList[i]].ticker,
          tokens[tokenList[i]].tokenAddress
        );
      }
      return _tokens;
    }

    function addToken(bytes32 _ticker, address _tokenAddress) external onlyAdmin {
        tokens[_ticker] = Token(_ticker, _tokenAddress);
        tokenList.push(_ticker);
    }

    function deposit(bytes32 _ticker, uint256 _amount) external tokenExists(_ticker) {
        IERC20(tokens[_ticker].tokenAddress).transferFrom(msg.sender, address(this), _amount);
        traderBalances[msg.sender][_ticker] = traderBalances[msg.sender][_ticker].add(_amount);
    }

    function withdraw(bytes32 _ticker, uint256 _amount) external tokenExists(_ticker) {
        require(traderBalances[msg.sender][_ticker] >= _amount, "insufficient balance");
        traderBalances[msg.sender][_ticker] = traderBalances[msg.sender][_ticker].sub(_amount);
        IERC20(tokens[_ticker].tokenAddress).transfer(msg.sender, _amount);
    }

    function limitOrder(
        bytes32 _ticker, 
        uint256 _amount, 
        uint256 _price, 
        Limit _side) external tokenExists(_ticker) preventStable(_ticker) {
            if(_side == Limit.SELL) {
                require(traderBalances[msg.sender][_ticker] >= _amount, "insufficient balance");
            } else {
                require(traderBalances[msg.sender][DAI] >= _amount.mul(_price), "not enough Dai");
            }
            Order[] storage orders = orderBook[_ticker][uint256(_side)];
            orders.push(Order(
                nextOrderId,
                msg.sender,
                _side,
                _ticker,
                _amount,
                0,
                _price,
                block.timestamp
            ));
            /*
            Bubble Sort Algorithm: Limit Orders
            */
            uint i = orders.length > 0 ? orders.length - 1 : 0;
            while(i > 0) {
                if(_side == Limit.BUY && orders[i - 1].price > orders[i].price) {
                    break;
                }
                if(_side == Limit.SELL && orders[i - 1].price < orders[i].price) {
                    break;
                }
                Order memory order = orders[i - 1];
                orders[i - 1] = orders[i];
                orders[i] = order;
                i --;
            }
            nextOrderId ++;
        }

    function marketOrder(
        bytes32 _ticker, 
        uint256 _amount, 
        Limit _side) external tokenExists(_ticker) preventStable(_ticker) {
            if(_side == Limit.SELL) {
                require(traderBalances[msg.sender][_ticker] >= _amount, "insufficient token balance");
            }
            Order[] storage orders = orderBook[_ticker][uint256(_side == Limit.BUY ? Limit.SELL : Limit.BUY)];
            uint256 i;
            uint256 toFill = _amount;

            // Run as long as length hasn't been reached and orders havne't been filled
            while(i < orders.length && toFill > 0) {
                // Available liquidity for each order in orderbook
                uint256 liquidity = orders[i].amount.sub(orders[i].filled);
                // if amount to fill is greater than liquidity:
                // take the full amount of liqudiity and subtract if from the total amount to fill.
                // Otherwise, subtract the exact amount filled from initial amount to fill.
                // Then sit the order to be filled equal to amount set in matched variable. 
                uint256 matched = (toFill > liquidity) ? liquidity : toFill;
                toFill = toFill.sub(matched);
                orders[i].filled = orders[i].filled.add(matched);
                emit NewTrade(
                    nextTradeId,
                    orders[i].id,
                    _ticker,
                    orders[i].trader,
                    msg.sender,
                    matched,
                    orders[i].price,
                    block.timestamp
                );
                if(_side == Limit.SELL) {
                    traderBalances[msg.sender][_ticker] = traderBalances[msg.sender][_ticker].sub(matched);
                    traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI].add(matched.mul(orders[i].price));
                    traderBalances[orders[i].trader][_ticker] = traderBalances[orders[i].trader][_ticker].add(matched);
                    traderBalances[orders[i].trader][DAI] -= traderBalances[orders[i].trader][DAI].sub(matched.mul(orders[i].price));
                }
                if(_side == Limit.BUY) {
                    require(traderBalances[msg.sender][DAI] >= matched * orders[i].price, "not enough Dai");
                    traderBalances[msg.sender][_ticker] = traderBalances[msg.sender][_ticker].add(matched);
                    traderBalances[msg.sender][DAI] = traderBalances[msg.sender][DAI].sub(matched.mul(orders[i].price));
                    traderBalances[orders[i].trader][_ticker] = traderBalances[orders[i].trader][_ticker].sub(matched);
                    traderBalances[orders[i].trader][DAI] -= traderBalances[orders[i].trader][DAI].add(matched.mul(orders[i].price));
                }
                nextTradeId ++;
                i ++; 
            }
            /*
            Matching Algorithm: clean up the array for each order match.
            */
            i = 0;
            while(i < orders.length && orders[i].filled == orders[i].amount) {
                for(uint j = i; j < orders.length - 1; j++) {
                    orders[j] = orders[j + 1];
                }
                orders.pop();
                i ++; 
            }
        }

    modifier tokenExists(bytes32 ticker) {
        require(tokens[ticker].tokenAddress != address(0), "Token does not exist");
        _;
    }

    modifier preventStable(bytes32 ticker) {
        require(ticker != DAI, "Cannot trade stablecoins");
        _;
    }

    modifier onlyAdmin {
        require(msg.sender == admin, "only admin is allowed to add tokens");
        _;
    }

}