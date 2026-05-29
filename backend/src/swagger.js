const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Farmers Marketplace API',
      version: '1.0.0',
      description:
        'REST API for the Farmers Marketplace — a platform where farmers list products and buyers pay using the Stellar Network (XLM).',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local dev server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['farmer', 'buyer'] },
            publicKey: { type: 'string', description: 'Stellar public key' },
            referralCode: { type: 'string' },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            farmer_id: { type: 'integer' },
            farmer_name: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            price: { type: 'number', description: 'Price in XLM' },
            quantity: { type: 'integer' },
            unit: { type: 'string' },
            image_url: { type: 'string', nullable: true },
            avg_rating: { type: 'number', nullable: true },
            review_count: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            buyer_id: { type: 'integer' },
            product_id: { type: 'integer' },
            product_name: { type: 'string' },
            quantity: { type: 'integer' },
            total_price: { type: 'number' },
            status: {
              type: 'string',
              enum: ['pending', 'paid', 'failed', 'processing', 'shipped', 'delivered'],
            },
            stellar_tx_hash: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: {} },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
