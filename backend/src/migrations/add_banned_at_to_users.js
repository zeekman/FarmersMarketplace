exports.up = async (knex) => {
  await knex.schema.table("users", (t) => {
    t.timestamp("banned_at").nullable().defaultTo(null);
    t.string("ban_reason").nullable();
  });
};
exports.down = async (knex) => {
  await knex.schema.table("users", (t) => {
    t.dropColumn("banned_at");
    t.dropColumn("ban_reason");
  });
};
