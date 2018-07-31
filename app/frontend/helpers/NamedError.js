function NamedError(name, message) {
  const e = new Error(message)
  e.name = name

  return e
}

module.exports = NamedError
