#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('../src/logger');

async function createBackup() {
  try {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const backupsDir = path.join(__dirname, '../backups');
    
    // Ensure backups directory exists
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      logger.info('Created backups directory');
    }
    
    // Determine database file path
    const dbPath = path.join(__dirname, '../market.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database file not found: ${dbPath}`);
    }
    
    const backupFileName = `market-${timestamp}.db`;
    const backupPath = path.join(backupsDir, backupFileName);
    
    // Copy database file
    fs.copyFileSync(dbPath, backupPath);
    
    logger.info(`Database backup created: ${backupFileName}`);
    
    // Clean up old backups (keep last 7)
    await cleanupOldBackups(backupsDir);
    
    console.log(`Backup created successfully: ${backupFileName}`);
    console.log(`Location: ${backupPath}`);
    
  } catch (error) {
    logger.error('Backup failed:', { error: error.message });
    console.error('Backup failed:', error.message);
    process.exit(1);
  }
}

async function cleanupOldBackups(backupsDir) {
  try {
    const files = fs.readdirSync(backupsDir);
    const backupFiles = files
      .filter(file => file.startsWith('market-') && file.endsWith('.db'))
      .map(file => ({
        name: file,
        path: path.join(backupsDir, file),
        mtime: fs.statSync(path.join(backupsDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first
    
    // Keep only the last 7 backups
    if (backupFiles.length > 7) {
      const filesToDelete = backupFiles.slice(7);
      
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        logger.info(`Deleted old backup: ${file.name}`);
      }
      
      console.log(`Cleaned up ${filesToDelete.length} old backup(s)`);
    }
  } catch (error) {
    logger.warn('Failed to cleanup old backups:', { error: error.message });
  }
}

// Run backup if this script is executed directly
if (require.main === module) {
  createBackup();
}

module.exports = { createBackup, cleanupOldBackups };
