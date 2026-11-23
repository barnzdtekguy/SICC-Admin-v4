'use strict';
const mysql = require('mysql2/promise');
const { config } = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: true,
  charset: 'utf8mb4',
});

// Prepared statement (values are always bound, never interpolated).
async function query(sql, values = []) {
  const [rows] = await pool.execute(sql, values);
  return rows;
}

async function queryOn(connection, sql, values = []) {
  if (!connection) return query(sql, values);
  const [rows] = await connection.execute(sql, values);
  return rows;
}

// DDL and multi-use statements that cannot be prepared.
async function rawQuery(sql, values = []) {
  const [rows] = await pool.query(sql, values);
  return rows;
}

async function transaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// LIMIT/OFFSET must be plain integers; clamp instead of binding.
function int(value, { min = 0, max = 1000000, fallback = 0 } = {}) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

module.exports = { pool, query, queryOn, rawQuery, transaction, int };
