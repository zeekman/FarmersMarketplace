/**
 * Unit tests for federation route (issue #1155)
 * Tests Stellar federation protocol endpoint
 */

const request = require('supertest');
const express = require('express');
const federationRouter = require('../routes/federation');
const db = require('../db/schema');

jest.mock('../db/schema');

const app = express();
app.use(express.json());
app.use('/federation', federationRouter);

describe('GET /federation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves federation address to Stellar account', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          stellar_public_key: 'GABC123DEF456GHI789JKL',
          federation_name: 'farmer1',
        },
      ],
    });

    const res = await request(app).get('/federation?q=farmer1*farmersmarket.example.com&type=name');

    expect(res.status).toBe(200);
    expect(res.body.stellar_address).toBe('farmer1*farmersmarket.example.com');
    expect(res.body.account_id).toBe('GABC123DEF456GHI789JKL');
  });

  test('handles case-insensitive federation names', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          stellar_public_key: 'GABC123',
          federation_name: 'farmer1',
        },
      ],
    });

    const res = await request(app).get('/federation?q=FARMER1*farmersmarket.example.com&type=name');

    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      ['farmer1'] // Lowercase
    );
  });

  test('returns 404 when user not found', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/federation?q=nonexistent*farmersmarket.example.com&type=name');

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('Not found');
  });

  test('returns 404 when user has no Stellar key', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          stellar_public_key: null,
          federation_name: 'farmer1',
        },
      ],
    });

    const res = await request(app).get('/federation?q=farmer1*farmersmarket.example.com&type=name');

    expect(res.status).toBe(404);
    expect(res.body.detail).toBe('Not found');
  });

  test('rejects queries without type=name', async () => {
    const res = await request(app).get('/federation?q=farmer1*farmersmarket.example.com&type=id');

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Only type=name is supported');
  });

  test('rejects queries without asterisk', async () => {
    const res = await request(app).get('/federation?q=farmer1&type=name');

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid federation address format. Expected name*domain');
  });

  test('rejects queries without q parameter', async () => {
    const res = await request(app).get('/federation?type=name');

    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('Invalid federation address format. Expected name*domain');
  });

  test('handles database errors', async () => {
    db.query.mockRejectedValue(new Error('Database connection failed'));

    const res = await request(app).get('/federation?q=farmer1*farmersmarket.example.com&type=name');

    expect(res.status).toBe(500);
    expect(res.body.detail).toBe('Database connection failed');
  });
});
