const Queue = require("bee-queue");
const config = require("../config.json");

const helloQ = new Queue(config.ipc.request_channel, {
  redis: config.ipc.redis
});

setInterval(_ => {

  const job = helloQ
    .createJob({method: "get value", payload: 1 })
    .save()
    .then(_ => {
      console.log(`job is queued with id ${_.id}`);
    })
    .catch(e => {
      console.log(`job failed ${e}`);
    });
}, 50);

helloQ.on("job succeeded", (jobId, result) => {
  console.log(`Job ${jobId} succeeded with result: ${JSON.stringify(result)}`);
});

helloQ.on("job failed", (jobId, result) => {
  console.log(`Job ${jobId} failed with result: ${result}`);
});
