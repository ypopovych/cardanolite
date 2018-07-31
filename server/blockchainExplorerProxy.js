require('isomorphic-fetch')

class RequestError extends Error {
  constructor(status, body) {
    super(body.toString())
    this.status = status
  }
}

module.exports = function(app, env) {
  app.get('/api/addresses/summary/:address', async (req, res) => {
    const address = req.params.address

    try {
      const response = await request(
        `${
          process.env.CARDANOLITE_BLOCKCHAIN_EXPLORER_PROXY_TARGET
        }/api/addresses/summary/${address}`
      )

      return res.status(200).send(response)
    } catch (err) {
      return res.status(err.status || 500).send({Left: err.message})
    }
  })

  app.get('/api/txs/summary/:txId', async (req, res) => {
    const txId = req.params.txId

    try {
      const response = await request(
        `${process.env.CARDANOLITE_BLOCKCHAIN_EXPLORER_PROXY_TARGET}/api/txs/summary/${txId}`
      )

      return res.status(200).send(response)
    } catch (err) {
      return res.status(err.status || 500).send({Left: err.message})
    }
  })

  app.get('/api/txs/raw/:txId', async (req, res) => {
    const txId = req.params.txId

    try {
      const response = await request(
        `${process.env.CARDANOLITE_BLOCKCHAIN_EXPLORER_PROXY_TARGET}/api/txs/raw/${txId}`
      )

      return res.status(200).send(response)
    } catch (err) {
      return res.status(err.status || 500).send({Left: err.message})
    }
  })

  app.post('/api/bulk/addresses/utxo', async (req, res) => {
    const addresses = req.body

    try {
      const result = {
        Right: [],
      }

      for (let i = 0; i < addresses.length; i += 10) {
        const response = await request(
          `${process.env.CARDANOLITE_BLOCKCHAIN_EXPLORER_PROXY_TARGET}/api/bulk/addresses/utxo`,
          'POST',
          JSON.stringify(addresses.slice(i, i + 10)),
          {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          }
        )

        result.Right = result.Right.concat(response.Right)
      }

      return res.status(200).send(result)
    } catch (err) {
      return res.status(err.status || 500).send({Left: err.message})
    }
  })
}

async function request(url, method = 'get', body = null, headers = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body,
  })
  if (res.status >= 400) {
    const errorText = await res.text()
    throw new RequestError(res.status, errorText !== '' ? errorText : 'Unknown error')
  }

  return res.json()
}
