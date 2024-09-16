import { writeFile } from 'fs/promises';
import { readFile } from 'fs/promises';

// Function to save the current state of the banks to a file
export async function saveBankState(banks, filePath = './banksState.json') {
  try {
    const bankData = JSON.stringify(banks, null, 2); // Convert banks to JSON
    await writeFile(filePath, bankData, 'utf8');     // Write JSON data to file
    console.log('Bank state saved successfully!');
  } catch (err) {
    console.error('Error saving bank state:', err);
  }
}

// Function to load the state of the banks from a file
export async function loadBankState(filePath = './banksState.json') {
  try {
    const data = await readFile(filePath, 'utf8');  // Read the file
    const loadedBanks = JSON.parse(data);           // Parse the JSON data
    console.log('Bank state loaded successfully!');
    return loadedBanks;
  } catch (err) {
    console.error('Error loading bank state:', err);
    return null;
  }
}
