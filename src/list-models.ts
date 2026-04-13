import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '..', '.env') });

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in .env');
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('Available Models:');
    data.models.forEach((m: any) => {
      console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(', ')})`);
    });
  } catch (error: any) {
    console.error('Error listing models:', error.message);
  }
}

listModels();
