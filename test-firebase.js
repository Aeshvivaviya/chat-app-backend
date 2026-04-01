import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

console.log('Testing Firebase service account...');
console.log('File exists:', fs.existsSync(serviceAccountPath));

if (fs.existsSync(serviceAccountPath)) {
  try {
    const content = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(content);
    console.log('✅ Service account loaded successfully');
    console.log('📋 Project ID:', serviceAccount.project_id);
    console.log('📧 Client Email:', serviceAccount.client_email);
    console.log('🔑 Private Key ID:', serviceAccount.private_key_id);
    
    // Check if private key is valid
    if (serviceAccount.private_key && serviceAccount.private_key.includes('BEGIN PRIVATE KEY')) {
      console.log('✅ Private key format looks correct');
    } else {
      console.log('❌ Private key format issue');
    }
  } catch (error) {
    console.error('❌ Error reading service account:', error.message);
  }
} else {
  console.log('❌ ERROR: serviceAccountKey.json not found!');
  console.log('💡 Please download it from Firebase Console:');
  console.log('1. Go to Firebase Console > Project Settings > Service Accounts');
  console.log('2. Click "Generate New Private Key"');
  console.log('3. Save as serviceAccountKey.json in chat-app-backend folder');
}