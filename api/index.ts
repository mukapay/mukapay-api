import 'dotenv/config'
import { Hono } from 'hono'
// import { handle } from 'hono/vercel'
import { serve } from '@hono/node-server'
import { createPublicClient, http } from 'viem'
import { baseSepolia, mainnet } from 'viem/chains'
import { getUsernameHash } from './util.js'
export const config = {
  runtime: 'edge'
}

// Initialize viem client
const client = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL as string)
})


const app = new Hono().basePath('/api')

app.get('/', (c) => {
  return c.json({ message: 'Hello Hono!' })
})

app.get('/users/:username/balance', async (c) => {
  const username = c.req.param('username')!
  const usernameHash = await getUsernameHash(username)

  try {
    const balance = await client.readContract({
      address: process.env.VAULT_ADDRESS as `0x${string}`, // USDC contract
      functionName: 'balances',
      abi: [
        {
          inputs: [{ name: 'account', type: 'uint256' }],
          name: 'balances',
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function'
        }
      ],
      args: [usernameHash]
    })

    return c.json({ 
      address: username,
      balance: balance.toString(),
      token: 'USDC'
    })
  } catch (error) {
    return c.json({ 
      error: 'Failed to fetch balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 400)
  }
})

// export default handle(app)
serve(app, (info) => {
  console.log(`Server is running on port ${info.port}`)
})