var fs = require('fs');
var Service, Characteristic, Doorstate; // Set in the module.exports from homebridge
var process = require('process'); 

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    DoorState = homebridge.hap.Characteristic.CurrentDoorState;

    homebridge.registerAccessory('homebridge-garage-gate-control', 'GarageGateControl', GarageGateControlAccessory);
}

function getVal(config, key, defaultVal) {
    var val = config[key];
    if (val == null) {
        return defaultVal;
    }
    return val;
}

function GarageGateControlAccessory(log, config){
    this.log = log;
    this.version = require('./package.json').version;
    log('GarageGateControlAccessory' + this.version);
    if (process.geteuid() != 0) {
        log('WARNING You are not running as root and may not be able to control the GPIO pins!');
    }
}