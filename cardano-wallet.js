const cbor = require('cbor')

const mnemonic = require('./mnemonic')
const tx = require('./transaction')
const address = require('./address')
const blockchainExplorer = require('./blockchain-explorer')
const utils = require('./utils')
const helpers = require('./helpers')
const config = require('./config')

exports.CardanoWallet = class CardanoWallet {
  constructor(rootSecret) {
    this.rootSecret = new tx.WalletSecretString(rootSecret)
  }

  fromMnemonic(mnemonic) {
    var rootSecret = mnemonic.mnemonicToWalletSecretString(mnemonic);
    return exports.CardanoWallet(rootSecret);
  }

  async sendAda(address, coins) {
    var transaction = await this.prepareTx(address, coins);

    var txHash = transaction.getId();
    var txBody = cbor.encode(transaction).toString("hex");

    return await this.submitTxRaw(txHash, txBody);
  }

  async prepareTx(address, coins) {
    const txInputs = await this.prepareTxInputs(coins)
    const txInputsCoinsSum = txInputs.reduce((acc, elem) => {
      return acc + elem.coins
    }, 0)

    const fee = this.computeTxFee(txInputs, coins)

    //comment this for developement
    if (fee === -1) {
      return false
    }

    const txOutputs = [
      new tx.TxOutput(new tx.WalletAddress(address), coins),
      new tx.TxOutput(
        new tx.WalletAddress(await this.getChangeAddress()),
        txInputsCoinsSum - fee - coins
      ),
    ]

    return new tx.Transaction(txInputs, txOutputs, {})
  }

  async getTxFee(address, coins) {
    const txInputs = await this.prepareTxInputs(coins)

    return this.computeTxFee(txInputs, coins)
  }

  async getBalance() {
    let result = 0

    const addresses = await this.getUsedAddresses()

    for (let i = 0; i < addresses.length; i++) {
      result += await blockchainExplorer.getAddressBalance(addresses[i])
    }

    return result
  }

  async prepareTxInputs(coins) {
    // TODO optimize tx inputs selection, now it takes all utxos
    const utxos = await this.getUnspentTxOutputsWithSecrets()

    const txInputs = []
    for (let i = 0; i < utxos.length; i++) {
      txInputs.push(
        new tx.TxInput(utxos[i].txHash, utxos[i].outputIndex, utxos[i].secret, utxos[i].coins)
      )
    }

    return txInputs
  }

  // if the fee cannot be paid it returns -1, otherwise it returns the fee
  computeTxFee(txInputs, coins) {
    if (coins > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Unsupported amount of coins: ${coins}`)
    }

    const txInputsCoinsSum = txInputs.reduce((acc, elem) => {
      return acc + elem.coins
    }, 0)

    const out1coins = coins
    const out2coinsUpperBound = txInputsCoinsSum - coins

    // the +1 is there because in the actual transaction the txInputs are encoded as indefinite length array
    const txInputsSize = cbor.encode(txInputs).length + 1

    /*
    * we assume that only two outputs (destination and change address) will be present
    * encoded in an indefinite length array
    */
    const txOutputsSize =
      2 * 77 + cbor.encode(out1coins).length + cbor.encode(out2coinsUpperBound).length + 2
    const txMetaSize = 1 // currently empty Map

    // the 1 is there for the CBOR "tag" for an array of 3 elements
    const txAuxSize = 1 + txInputsSize + txOutputsSize + txMetaSize

    const txWitnessesSize = txInputs.length * 139 + 1

    // the 1 is there for the CBOR "tag" for an array of 2 elements
    const txSizeInBytes = 1 + txAuxSize + txWitnessesSize

    /*
    * the deviation is there for the array of tx witnesses - it may have more than 1 byte of overhead
    * if more than 16 elements are present
    */
    const deviation = 4

    const fee = this.constructor.txFeeFunction(txSizeInBytes + deviation)

    if (txInputsCoinsSum - coins - fee < 0) {
      return -1
    }

    return fee
  }

  async getChangeAddress(usedAddressesLimit = 20) {
    const usedAddressesAndSecrets = await this.getUsedAddressesAndSecrets()

    let result = undefined

    if (usedAddressesAndSecrets.length < usedAddressesLimit) {
      const highestUsedChildIndex = usedAddressesAndSecrets.reduce((acc, item) => {
        return Math.max(item.childIndex, acc)
      }, 0)

      result = address.deriveAddressAndSecret(this.rootSecret, highestUsedChildIndex + 1).address
    } else {
      result = usedAddressesAndSecrets[Math.floor(Math.random() * usedAddressesAndSecrets.length)].address
    }

    return result
  }

  async getUnspentTxOutputsWithSecrets() {
    var result = []

    const addresses = await this.getUsedAddressesAndSecrets()

    for (var i = 0; i < addresses.length; i++) {
      const addressUnspentOutputs = await blockchainExplorer.getUnspentTxOutputs(addresses[i].address)

      addressUnspentOutputs.map((element) => {
        element.secret = addresses[i].secret
      })

      var result = result.concat(addressUnspentOutputs)
    }

    return result
  }

  async getUsedAddressesAndSecrets() {
    let result = [];

    for (let i = 0; ; i++) {
      let usedAddresses = await helpers.filter(this.deriveAddressesAndSecrets(i*20, (i + 1)*20), async (addressData) => {
        return await blockchainExplorer.isAddressUsed(addressData.address)
      })

      if (usedAddresses.length === 0) {
        break;
      }

      result = result.concat(usedAddresses)
    }

    return result
  }

  deriveAddresses(begin = 0, end = 20) {
    return this.deriveAddressesAndSecrets(begin, end).map((item) => item.address);
  }


  deriveAddressesAndSecrets(begin = 0, end = 20) {
    const result = []
    for (let i = begin; i < end; i++) {
      result.push(address.deriveAddressAndSecret(this.rootSecret, 0x80000001 + i))
    }

    return result
  }

  async getUsedAddresses() {
    return (await this.getUsedAddressesAndSecrets()).map((item) => {
      return item.address
    })
  }

  static txFeeFunction(txSizeInBytes) {
    const a = 155381
    const b = 43.946

    return Math.ceil(a + txSizeInBytes * b)
  }

  async submitTxRaw(txHash, txBody) {
    try {
      const res = await utils.request(
        config.transaction_submitter_url,
        "POST",
        JSON.stringify({
          txHash,
          txBody,
        }),
        {
          'Content-Type': 'application/json',
        }
      )

      if (res.status >= 300) {
        throw Error(res.status + " " + JSON.stringify(res));
      }
      else {
        return res.result;
      }
    } catch (err) {
      throw Error("txSubmiter unreachable " + err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.CardanoWallet = exports.CardanoWallet
}
