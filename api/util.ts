import * as circomlibjs from "circomlibjs";
import * as snarkjs from "snarkjs";

function strToField(str: string) {
    const bytes = Buffer.from(str);
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) + BigInt(bytes[i]);
    }
    return result;
}


export async function getUsernameHash(username: string) {
    // Initialize Poseidon
    const poseidon = await circomlibjs.buildPoseidon();

    // Convert username to field element
    const usernameField = strToField(username);

    // Generate Poseidon hash
    const usernameHash = poseidon([usernameField]);

    // Return the hash as a string
    return poseidon.F.toString(usernameHash);
}

export async function generateCredentialHash(username: string, password: string) {
    const poseidon = await circomlibjs.buildPoseidon();
    const usernameField = strToField(username);
    const passwordField = strToField(password);
    const credentialHash = poseidon([usernameField, passwordField]);
    return poseidon.F.toString(credentialHash);
}

export const formatProof = (proof: any) => ({
    pi_a: proof.proof.pi_a.slice(0, 2),
    pi_b: [
      [proof.proof.pi_b[0][1], proof.proof.pi_b[0][0]],
      [proof.proof.pi_b[1][1], proof.proof.pi_b[1][0]]
    ],
    pi_c: proof.proof.pi_c.slice(0, 2)
  });

  export async function generateProof(username: string, password: string, nonce = Date.now()) {
    // Initialize Poseidon
    const poseidon = await circomlibjs.buildPoseidon();

    // Convert inputs to field elements
    const usernameField = strToField(username);
    const passwordField = strToField(password);

    // Generate Poseidon hashes
    const usernameHash = poseidon([usernameField]);
    const credentialHash = poseidon([usernameField, passwordField]);

    // Create final hash with credential hash and nonce
    const finalHash = poseidon([credentialHash, BigInt(nonce)]);

    // Create input for the circuit
    const input = {
        username: usernameField.toString(),
        password: passwordField.toString(),
        username_hash: poseidon.F.toString(usernameHash),
        credential_hash: poseidon.F.toString(credentialHash),
        nonce: nonce.toString(),
        result_hash: poseidon.F.toString(finalHash)
    };

    // Generate the proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        "circuits/circuit_js/circuit.wasm",
        "circuits/circuit_final.zkey"
    );

    return { 
        proof, 
        publicSignals,
        input,
    };
}