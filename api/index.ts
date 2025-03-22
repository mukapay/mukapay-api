import 'dotenv/config'
import { Hono } from 'hono'
// import { handle } from 'hono/vercel'
import { serve } from '@hono/node-server'
import { createPublicClient, decodeEventLog, encodeFunctionData, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { formatProof, generateCredentialHash, getUsernameHash } from './util.js'
import { abi } from './constant.js'
import { createBundlerClient, toCoinbaseSmartAccount } from 'viem/account-abstraction'

import { createClient } from '@supabase/supabase-js'

// Create a single supabase client for interacting with your database
const supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_KEY as string)


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
    const { data } = await supabase.from('vault_balances').select('*').eq('username_hash', usernameHash).maybeSingle()
    if (!data) {
      return c.json({
        error: 'User not found',
        message: 'User not found'
      }, 404)
    }


    // const balance = await client.readContract({
    //   address: process.env.VAULT_ADDRESS as `0x${string}`, // USDC contract
    //   functionName: 'balances',
    //   abi,
    //   args: [usernameHash]
    // })

    return c.json({
      username,
      username_hash: usernameHash,
      balance: data.amount,
      token: 'USDC'
    })
  } catch (error) {
    return c.json({
      error: 'Failed to fetch balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 400)
  }
})


app.get('/users/:username/history', async (c) => {
  const username = c.req.param('username')!
  const usernameHash = await getUsernameHash(username)

  try {
    const { data } = await supabase
      .from('history')
      .select('*')
      .or(`from_user.eq.${usernameHash},to_user.eq.${usernameHash}`)
      .order('block_number', { ascending: false });

    if (!data) {
      return c.json({
        error: 'User not found',
        message: 'User not found'
      }, 404)
    }


    return c.json({
      history: data
    })
  } catch (error) {
    return c.json({
      error: 'Failed to fetch balance',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 400)
  }
})

app.get('/wallets/:address/balance', async (c) => {
  const address = c.req.param('address')!

  try {
    const balance = await client.readContract({
      address: process.env.USDC_ADDRESS as `0x${string}`, // USDC contract
      functionName: 'balanceOf',
      abi: [
        {
          inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ internalType: 'uint256', name: 'balance', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function'
        }
      ],
      args: [address as `0x${string}`]
    })
    return c.json({
      address: address,
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
  const { proof } = await c.req.json()

  // check if user is already registered
  const { data } = await supabase.from('event_registered').select('*').eq('username_hash', proof.input.username_hash).maybeSingle()
  if (data) {
    return c.json({
      error: 'User already registered',
      message: 'User already registered'
    }, 400)
  }

  const proofFormatted: any = formatProof(proof)

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
    estimateGas: async (userOperation: any) => {
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

  const paymentFormatted: any = formatProof(proof)

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
    estimateGas: async (userOperation: any) => {
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

app.get('/txs/:tx', async (c) => {
  const tx = c.req.param('tx')!

  const tx_hash = await client.getTransaction({ hash: tx as `0x${string}` })


  return c.json({
    tx_hash: tx_hash
  })
})

app.post('/webhooks/quicknode', async (c) => {
  try {
    const { data } = await c.req.json()

    for (const log of data) {
      console.log("log", JSON.stringify(log))
      const rawLog = {
        address: log.address,
        topics: log.topics,
        data: log.data
      }
      console.log('rawlog', JSON.stringify(rawLog))

      const event = decodeEventLog({
        abi: abi,
        data: rawLog.data,
        topics: rawLog.topics
      })
      // const event = contract.interface.parseLog({ data: rawLog.data, topics: rawLog.topics })!
      if (!event) {
        continue
      }

      console.log("event", JSON.stringify({
        ...event,
        args: Object.entries(event.args).map(([key, value]) => ({
          [key]: value.toString()
        }))
      }))
      // switch (event.topic) {
      //   case "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b": // Upgraded
      //   case "0x7f26b83ff96e1f2b6a682f133852f6798a09c465da95921460cefb3847402498": //Initialized 
      //   case "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d": // RoleGranted
      //   case "0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f": // AdminChanged 
      //     continue
      // }
      const block_number = Number(log.blockNumber)
      const tx = {
        txhash: log.transactionHash,
        log_index: Number(log.logIndex),
        name: event.eventName,
        contract_address: log.address,
        block_number: block_number.toString(),
        timestamp: Number((await client.getBlock({ blockNumber: BigInt(block_number) })).timestamp),
      }

      console.log("tx", JSON.stringify(tx))

      switch (event.eventName) {
        case 'Deposited': {
          const transaction = await client.getTransaction({ hash: log.transactionHash as `0x${string}` })
          console.log("transaction", (transaction))
    
          const data = {
            amount: event.args.amount.toString(),
            username_hash: event.args.usernameHash.toString(),
            tx_hash: tx.txhash,
            log_index: tx.log_index,
            block_time: new Date(tx.timestamp! * 1000).toISOString().replace('.000Z', 'Z'),
            block_number: tx.block_number,
            from_address: transaction.from,
          }
          console.log(data)
          const { data: result } = await supabase.from('event_deposited')
            .upsert(data)
            .throwOnError()
            .select()
          console.log('result', result)
          break
        }
        case "Paid": {
          const data = {
            amount: event.args.amount.toString(),
            from_username_hash: event.args.fromUsernameHash.toString(),
            to_username_hash: event.args.toUsernameHash.toString(),
            tx_hash: tx.txhash,
            log_index: tx.log_index,
            block_time: new Date(tx.timestamp! * 1000).toISOString().replace('.000Z', 'Z'),
            block_number: tx.block_number,
          }
          const { data: result } = await supabase.from('event_paid')
            .upsert(data)
            .throwOnError()
            .select()
          console.log('result', result)
          break
        }
        case 'Withdrawn': {
          const data = {
            amount: event.args.amount.toString(),
            from_username_hash: event.args.fromUsernameHash.toString(),
            to_user_address: event.args.toUserAddress.toString(),
            tx_hash: tx.txhash,
            log_index: tx.log_index,
            block_time: new Date(tx.timestamp! * 1000).toISOString().replace('.000Z', 'Z'),
            block_number: tx.block_number,
          }
          console.log(data)
          const { data: result } = await supabase.from('event_withdrawn')
            .upsert(data)
            .throwOnError()
            .select()
          console.log('result', result)
          break
        }
        case "Registered": {
          const data = {
            username_hash: event.args.usernameHash.toString(),
            credential_hash: event.args.credentialHash.toString(),
            tx_hash: tx.txhash,
            log_index: tx.log_index,
            block_time: new Date(tx.timestamp! * 1000).toISOString().replace('.000Z', 'Z'),
            block_number: tx.block_number,
          }
          console.log(data)
          const { data: result } = await supabase.from('event_registered')
            .upsert(data)
            .throwOnError()
            .select()
          console.log('result', result)
          break
        }
      }
    }
    return c.json({ message: 'Webhook received' })

  } catch (error) {
    console.error("Error sending transaction:", error)
    return c.json({
      error: 'Failed to send transaction',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 400)
  }

})

app.post('/withdraw', async (c) => {
  const { proof, to_user_address, amount } = await c.req.json()
  const withdrawalFormatted: any = formatProof(proof);


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
        to_user_address,
        proof.input.credential_hash,
        proof.input.nonce,
        proof.input.result_hash,
        amount
      ],
    })
  }

  account.userOperation = {
    estimateGas: async (userOperation: any) => {
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