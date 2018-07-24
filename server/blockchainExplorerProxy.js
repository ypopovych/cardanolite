require('isomorphic-fetch')

const EXPLORER_API = 'https://cardanoexplorer.com'

module.exports = function (app, env) {
  app.get('/api/addresses/summary/:address', async (req, res) => {
    const address = req.params.address

    const response = await request(`${EXPLORER_API}/api/addresses/summary/${address}`)

    return res.status(200).send(response)
  })

  app.get('/api/txs/summary/:txId', async (req, res) => {
    const txId = req.params.txId

    const response = await request(`${EXPLORER_API}/api/txs/summary/${txId}`)

    return res.status(200).send(response)
  })
}

async function request(url, method = 'get', body = null, headers = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body,
  })
  if (res.status >= 400) {
    throw new Error(res.status)
  }

  return res.json()
}