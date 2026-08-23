module.exports = {
  apps: [
    {
      name: "testify-maps-arm",
      script: "docker",
      args: "compose -f infra/docker-compose-arm.yml up",
      autorestart: true,
      watch: false
    }
  ]
};
