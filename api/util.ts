import * as circomlibjs from "circomlibjs";

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