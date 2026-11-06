// Keep each DDP connection within its own subscription budget. A shared bucket
// lets one user's navigation exhaust the allowance for every other user.
DDPRateLimiter.addRule({
  type: 'subscription',
  connectionId: () => true,
}, 50, 10000);
