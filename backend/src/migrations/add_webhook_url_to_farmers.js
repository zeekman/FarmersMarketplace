exports.up = async (knex) => {
  await knex.schema.table("farmers", (t) => {
    t.string("webhook_url").nullable();
    t.string("webhook_secret", 64).nullable();
  });
  await knex.schema.createTable("webhook_deliveries", (t) => {
    t.increments("id");
    t.integer("order_id").notNullable();
    t.string("event").notNullable();
    t.string("url").notNullable();
    t.integer("status_code").nullable();
    t.boolean("success").defaultTo(false);
    t.text("response_body").nullable();
    t.integer("attempt").defaultTo(1);
    t.timestamps(true, true);
  });
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists("webhook_deliveries");
  await knex.schema.table("farmers", (t) => {
    t.dropColumn("webhook_url");
    t.dropColumn("webhook_secret");
  });
};
