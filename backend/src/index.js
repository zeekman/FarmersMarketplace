const app = require('./app');
const { startSubscriptionJob } = require('./jobs/processSubscriptions');
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  startSubscriptionJob();
});
