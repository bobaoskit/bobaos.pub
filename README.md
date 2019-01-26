# bobaos.pub

Hello, friend.

This module is an update for bdsd.sock. 

## Improvements: 

- Using Bee-Queue and Redis as a backend for interprocess communication.
- Clean code, there is no more mess in index.js anymore.
- Removed unnecessary  methods in protocol. 
  No more "read value"/"read values". Now it depends on payload type. 
  For multiple get/set/read methods payload should be array of items.
- Support for get/set server item, parameter byte methods.

## Architecture

Bobaos.Pub uses [redis](https://redis.io/) and [bee-queue](https://www.npmjs.com/package/bee-queue) to accepts requests.

1. It creates queue with name defined `config.json/ipc.request_channel`, by default it is `bobaos_req`.
2. It creates queue with name defined `config.json/ipc.service_channel`, by default it is `bobaos_service`.
3. It broadcasts events like `datapoint value`, `server item`, `sdk status` over channel defined in `config.json`, by default it is `bobaos_bcast`.

Request queue serves common requests like `get datapoint value`, etc.
Service queue serves requests `ping/get sdk state/reset`, so, if program stuck at datapoint method, it will be possible to reset sdk.

## Installation

1. Install redis, enable and start service. If needed, apply your settings.

```text
sudo apt install redis-server
sudo systemctl daemon-reload
sudo systemctl start redis.service
```

2. Install bobaos.pub package.

```
sudo npm i -g bobaos.pub --unsafe-perm
```
3. Configure serialport, write your device (`/dev/ttyS*` or `/dev/ttyAMA0` for RPi) to `/usr/lib/node_modules/bobaos.pub/config.json`.
4. Create service file for systemd `/etc/systemd/system/bobaos_pub.service`:

```
[Unit]
Description=PubSub service running on nodejs
After=redis.service

[Service]
User=pi
ExecStart=/usr/bin/env bobaos-pub
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Reload systemd daemon, enable and start service.

```
sudo systemctl daemon-reload
sudo systemctl enable bobaos_pub.service
sudo systemctl start bobaos_pub.service
```

5. Test it with bobaos.tool

```text
$ sudo npm i -g bobaos.tool
$ bobaos-tool
bobaos> ping
ping: true
```

## Protocol

First, Bee-Queue job is sent to `config.ipc.request_channel` with data object, consist following fields:

* `method` is an API method.
* `payload` depends on method. It may be datapoint id, array of ids, value, or null.

Request:

```
{
  "method": "get parameter byte",
  "payload": [1,2,3,4]
}
```

Response is processes by `queue.on("job succeeded")`:

```
{
  "method": "success",
  "payload": [1,3,5,7]
}
```

In case of error, `method` field in response will contain "error" string and payload will describe error.

## Client libraries

To write nodejs applications use [bobaos.sub](https://github.com/bobaoskit/bobaos.sub) client library.
