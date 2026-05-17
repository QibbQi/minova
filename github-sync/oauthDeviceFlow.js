function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function startDeviceFlow({ clientId, scope }) {
  const body = new URLSearchParams()
  body.set('client_id', clientId)
  if (scope) body.set('scope', scope)

  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    mode: 'cors',
    credentials: 'omit',
    body
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Device flow init failed: ${JSON.stringify(data)}`)
  return data
}

export async function pollDeviceFlow({ clientId, deviceCode, interval }) {
  const waitSeconds = Math.max(1, parseInt(interval || 5, 10))
  while (true) {
    await sleep(waitSeconds * 1000)
    const body = new URLSearchParams()
    body.set('client_id', clientId)
    body.set('device_code', deviceCode)
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code')

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      body
    })
    const data = await res.json()
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') continue
    if (data.error) throw new Error(`Device flow token failed: ${JSON.stringify(data)}`)
    return data
  }
}
