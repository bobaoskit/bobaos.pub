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

In addition to queues, bobaos.pub listen redis pubsub channels with same names(`bobaos_req`/`bobaos_service`) for incoming request in stringified json. This feature is supported from version `bobaos.pub@2.0.8`.

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

### bee-queue

Bee-Queue job is sent to `config.ipc.request_channel` with data object, consist following fields:

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

### redis pub/sub channels

Since version 2.0.8 this feature is supported to simplify job adding.

bobaos.pub listens request and service channels and on incoming request it add job to corresponding queue.

Only difference from bee-queue request is that request should contain `response_channel` field, so request sender will receive response from bobaos on that channel. This channels may be randomly generated, then subscribed, and after request was sent and response came, client may unsubscribe from this channel.

### service methods

#### ping

**payload**: null

If bobaos.pub service is running, true will be returned as a response payload.

#### get sdk state

**payload**: null

Response payload: "ready"/"stopped".

#### reset

**payload**: null

#### get version

**payload**: null

Get version of bobaos.pub npm package.

### baos methods

#### get description

**payload**: null/number/array of numbers

Returns descriptions for given object ids. If payload is null, return description for all configured datapoints.

Response payload example: 

```text
{
  "valid": "true",
  "id": "1",
  "length": "2",
  "dpt": "dpt9",
  "flag_priority": "low",
  "flag_communication": "true",
  "flag_read": "false",
  "flag_write": "true",
  "false": "false",
  "flag_readOnInit": "false",
  "flag_update": "true",
  "flag_transmit": "true",
  "value": "23.6",
  "raw": "DJw="
}
```

#### get value

**payload**: number/array of numbers

Returns values for given object ids. Sends data to BAOS via UART. When received, value is saved in redis, so can be got also by `get stored value` method. It is recommended to get values for multiple datapoints at once to reduce UART message count.

Response payload example:

```text
{
  "id":1,
  "value":23.6,
  "raw":"DJw="
}
```

#### get stored value

Returns value as `get value` method, but without data sending by UART. Values is taken from redis database.

#### poll values

**payload**: null

Returns values for all configured datapoints.  May take a while to accomplish. Response payload is the same as for `get values`/`get stored values`.

#### set value

**payload**: Object/Array of objects

Request payload object should be one of following: `{ id: <Number>, value: <Value> }`, `{ id: <Number>, raw: <String> }`, where raw is base64 encoded buffer. 

If payload is array of objects, it is possible to combine value types, so following payload is valid:

```text
[
  {id: 2, value: true}
  {id: 3, raw: "AA=="}
]
```

After values are sent to bus, bobaos.pub broadcasts them via pubsub channel `bobaos_bcast`.

#### read value

**payload**: number/array of numbers

#### get server item

**payload**: null/number/array of numbers

If payload is null, all server items to be returned in response.

Response payload example:

```text
[
  {
    "id": 1,
    "value": [ 0, 0, 197, 8, 0, 3],
    "raw": "AADFCAAD"
  },
  {
    "id": 2,
    "value": [ 16 ],
    "raw": "EA=="
  },
  {
    "id": 3,
    "value": [ 18 ],
    "raw": "Eg=="
  }
]
```

#### set programming mode

**payload**: 1/0/true/false

#### get programming mode

**payload**: null

Response payload: true/false

#### get parameter byte

**payload**: number/array of numbers

Response payload example: 

```text
[ 0, 1, 2, 5, 7, 3]
```

### broadcasted events

**TODO**

## Client libraries

To write nodejs applications use [bobaos.sub](https://github.com/bobaoskit/bobaos.sub) client library.

Basic Java library [jobaos](https://github.com/shabunin/org.openhab.binding.bobaos/tree/master/src/main/java/org/openhab/binding/bobaos/internal/jobaos).

**Help needed**. 

## Credits

* To people working on KNX standard
* To Weinzierl team for great API
* To all open source community
* To jgs for [mouse art](https://www.asciiart.eu/animals/rodents/mice)
