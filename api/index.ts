import 'dotenv/config'
import { Hono } from 'hono'
// import { handle } from 'hono/vercel'
import { serve } from '@hono/node-server'
import { createPublicClient, encodeFunctionData, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { getUsernameHash } from './util.js'
import { abi } from './constant.js'
import { createBundlerClient, toCoinbaseSmartAccount } from 'viem/account-abstraction'

// export const config = {
//   runtime: 'edge'
// }


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
      abi,
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

app.post('/pay', async (c) => {
  const { payment_proof, from_hash, to_hash, amount } = await c.req.json()

  const paymentFormatted = {
    pi_a: payment_proof.proof.pi_a.slice(0, 2),
    pi_b: [
      [payment_proof.proof.pi_b[0][1], payment_proof.proof.pi_b[0][0]],
      [payment_proof.proof.pi_b[1][1], payment_proof.proof.pi_b[1][0]]
    ],
    pi_c: payment_proof.proof.pi_c.slice(0, 2)
  };

  const adminPrivateKey = generatePrivateKey()
  const admin = privateKeyToAccount(adminPrivateKey)


  const account = await toCoinbaseSmartAccount({
    client,
    owners: [admin],
  })

  const bundlerClient = createBundlerClient({
    account,
    client,
    transport: http(process.env.RPC_URL as string),
    chain: baseSepolia
  })

  console.log(amount)

  const payCall = {
    to: process.env.VAULT_ADDRESS as `0x${string}`,
    data: encodeFunctionData({
      abi,
      functionName: 'pay',
      args: [
        paymentFormatted.pi_a,
        paymentFormatted.pi_b,
        paymentFormatted.pi_c,
        from_hash,
        to_hash,
        payment_proof.publicSignals[1],
        payment_proof.publicSignals[2],
        amount
      ],
    })
  }

  account.userOperation = {
    estimateGas: async (userOperation) => {
      console.log("Estimating gas for user operation:", userOperation)
      const estimate = await bundlerClient.estimateUserOperationGas(userOperation);
      console.log("Initial gas estimate:", estimate)

      // Adjust gas limits for complex transactions
      estimate.preVerificationGas = estimate.preVerificationGas * 2n;
      return estimate;
    },
  };

  try {
    const userOpHash = await bundlerClient.sendUserOperation({
      account,
      calls: [payCall],
      paymaster: true
    })

    console.log("UserOperation Hash:", userOpHash)

    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash,
    })

    return c.json({
      bundler_tx_hash: userOpHash,
      sender: account.address,
      tx_hash: receipt.receipt.transactionHash
    })
  } catch (error) {
    console.error("Error sending transaction:", error)
    return c.json({
      error: 'Failed to send transaction',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 400)
  }


})

// export default handle(app)
serve(app, (info) => {
  console.log(`Server is running on port ${info.port}`)
})