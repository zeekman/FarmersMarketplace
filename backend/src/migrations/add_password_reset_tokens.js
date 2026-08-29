exports.up = async (knex) => {
  await knex.schema.createTable("password_reset_tokens", (t) => {
    t.increments("id");
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("token_hash", 64).notNullable().unique();
    t.timestamp("expires_at").notNullable();
    t.timestamp("used_at").nullable();
    t.timestamps(true, true);
  });
};
exports.down = async (knex) => knex.schema.dropTableIfExists("password_reset_tokens");
