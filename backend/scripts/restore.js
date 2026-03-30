#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('../src/logger');

async function restoreFromBackup(backupFilePath) {
  try {
    if (!backupFilePath) {
      throw new Error('Backup file path is required');
    }
    
    // Resolve backup file path
    const resolvedBackupPath = path.resolve(backupFilePath);
    
    if (!fs.existsSync(resolvedBackupPath)) {
      throw new Error(`Backup file not found: ${resolvedBackupPath}`);
    }
    
    // Validate backup file format
    const fileName = path.basename(resolvedBackupPath);
    if (!fileName.startsWith('market-') || !fileName.endsWith('.db')) {
      throw new Error('Invalid backup file format. Expected format: market-YYYY-MM-DD.db');
    }
    
    // Determine database file path
    const dbPath = path.join(__dirname, '../market.db');
    const dbBackupPath = path.join(__dirname, '../market.db.backup');
    
    // Create a backup of current database before restore
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbBackupPath);
      logger.info('Created backup of current database before restore');
    }
    
    // Restore from backup
    fs.copyFileSync(resolvedBackupPath, dbPath);
    
    logger.info(`Database restored from: ${fileName}`);
    console.log(`Database restored successfully from: ${fileName}`);
    console.log(`Previous database backed up to: ${dbBackupPath}`);
    
  } catch (error) {
    logger.error('Restore failed:', { error: error.message });
    console.error('Restore failed:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node restore.js <backup-file-path>');
    console.error('Example: node restore.js backups/market-2024-01-01.db');
    process.exit(1);
  }
  
  const backupFilePath = args[0];
  restoreFromBackup(backupFilePath);
}

module.exports = { restoreFromBackup };
