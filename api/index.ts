import 'dotenv/config'
import { Hono } from 'hono'
// import { handle } from 'hono/vercel'
import { serve } from '@hono/node-server'
import { createPublicClient, encodeFunctionData, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { formatProof, generateCredentialHash, getUsernameHash } from './util.js'
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

app.get('/proof/pay', async (c) => {
  const { username, password } = await c.req.json()
  
  const credentialHash = await generateCredentialHash(username, password)
  return c.json({ credentialHash })
})

app.post('/register', async (c) => {
  const { proof} = await c.req.json()

  const proofFormatted : any = formatProof(proof)

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

  const call = {
    to: process.env.VAULT_ADDRESS as `0x${string}`,
    data: encodeFunctionData({
      abi,
      functionName: 'register',
      args: [
        proofFormatted.pi_a,
        proofFormatted.pi_b,
        proofFormatted.pi_c,
        proof.input.username_hash,
        proof.input.credential_hash,
        proof.publicSignals[2],
        proof.publicSignals[3],
      ],
    })
  }

  account.userOperation = {
    estimateGas: async (userOperation:any) => {
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
      calls: [call],
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


app.post('/pay', async (c) => {
  const { proof, to_username_hash, amount } = await c.req.json()

  const paymentFormatted : any = formatProof(proof)

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

  const payCall = {
    to: process.env.VAULT_ADDRESS as `0x${string}`,
    data: encodeFunctionData({
      abi,
      functionName: 'pay',
      args: [
        paymentFormatted.pi_a,
        paymentFormatted.pi_b,
        paymentFormatted.pi_c,
        proof.input.username_hash,
        to_username_hash,
        proof.input.credential_hash,
        proof.input.nonce,
        proof.input.result_hash,
        amount
      ],
    })
  }

  account.userOperation = {
    estimateGas: async (userOperation:any) => {
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

app.post('/withdraw', async (c) => {
  const { proof, to_address, amount } = await c.req.json()

  const withdrawalFormatted : any = formatProof(proof);


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
      functionName: 'withdraw',
      args: [
        withdrawalFormatted.pi_a,
        withdrawalFormatted.pi_b,
        withdrawalFormatted.pi_c,
        proof.input.username_hash,
        to_address,
        proof.input.credential_hash,
        proof.input.nonce,
        proof.input.result_hash,
        amount
      ],
    })
  }

  account.userOperation = {
    estimateGas: async (userOperation:any) => {
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