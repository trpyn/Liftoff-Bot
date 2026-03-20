#!/usr/bin/env node

/**
 * Create an admin user from the command line.
 *
 * Usage:
 *   node src/cli/createUser.js <username> <password>
 */

require('dotenv').config();

const { initDatabase } = require('../db/connection');
const { createUser, getUserByUsername } = require('../db/adminUsers');
const { hashPassword } = require('../auth');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node src/cli/createUser.js <username> <password>');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Error: Password must be at least 6 characters');
  process.exit(1);
}

initDatabase();

const existing = getUserByUsername(username);
if (existing) {
  console.error(`Error: User "${username}" already exists`);
  process.exit(1);
}

const user = createUser(username, hashPassword(password));
console.log(`Admin user created: ${user.username} (id: ${user.id})`);
