"use strict";

var Moon                 = require("node-simaudio-moon"),
    RoonApi              = require("node-roon-api"),
    RoonApiSettings      = require('node-roon-api-settings'),
    RoonApiStatus        = require('node-roon-api-status'),
    RoonApiVolumeControl = require('node-roon-api-volume-control'),
    RoonApiSourceControl = require('node-roon-api-source-control'),
    SerialPort           = require("serialport");

var roon = new RoonApi({
    extension_id:        'com.guymaurier.simaudio.moon',
    display_name:        'Moon Volume/Source/Power Control',
    display_version:     "0.1.1",
    publisher:           'Guy Maurier',
    email:               'guymaurier@outlook.com',
    website:             'https://github.com/guymaurier/roon-extension-simaudio-moon',
});

var mysettings = roon.load_config("settings") || {
    serialport:  "",
    setsource:   "01",
	volumesteps: "50",
    setspeaker:  "on"
};

let ports = new Array();
ports.list = new Array();

//Detect and list available serial ports for the settings' page
function serialportsetup() {
    return new Promise(resolve =>{
        SerialPort.list().then(portsdetected => {
            portsdetected.forEach(function(port) {
                let portobj =  { title: port.path, value: port.path };
                ports.push(portobj);
                ports.list.push(port.path)
            });
            console.log("[Moon Extension] Serial ports detected: ");
            console.log(ports.list);
            if (!mysettings.serialport) {
                console.log("[Moon Extension] No serial port configured!");
            } else if (ports.list.indexOf(mysettings.serialport) < 0) {
                console.log("[Moon Extension] Configured port " + mysettings.serialport + " no longer exists!");
                mysettings.serialport = "";
            }
            resolve();
        });
    });
}

var moon = { };
// Build layout for settings' page in the Roon's Extensions
function makelayout(settings) {
    var l = {
        values:    settings,
	    layout:    [],
	    has_error: false
       };

        l.layout.push({
            type:      "dropdown",
            title:     "Serial Port",
            values:     ports,
            setting:   "serialport",
        });
    
    l.layout.push({
        type:    "dropdown",
        title:   "Source for Convenience Switch",
        values:  [
            { value: "00", title: "MP" },
            { value: "01", title: "CD" },
            { value: "02", title: "A1" },
            { value: "03", title: "A2 / HT" },
            { value: "04", title: "A3 / Phono" },
            { value: "05", title: "Balanced" },
            { value: "06", title: "D1" },
            { value: "07", title: "D2" },
            { value: "08", title: "D3" },
            { value: "09", title: "D4" }
        ],
        setting: "setsource",
    });

    l.layout.push({
        type:    "dropdown",
        title:   "Volume Steps",
        values:  [
            { value: "50", title: "Small" },
            { value: "500", title: "Medium" },
            { value: "1000", title: "Large" }
        ],
        setting: "volumesteps",
    });

    l.layout.push({
        type:    "dropdown",
        title:   "Speaker Output",
        values:  [
            { value: "on", title: "On" },
            { value: "off", title: "Off" }
        ],
        setting: "setspeaker",
    });
    return l;
}

var svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
	let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            var oldport = mysettings.serialport;
            mysettings = l.values;
            svc_settings.update_settings(l);
            let force = false;
            if (oldport != mysettings.serialport) force = true;
            if (force) setup();
            roon.save_config("settings", mysettings);
        }
    }
});

var svc_status = new RoonApiStatus(roon);
var svc_volume_control = new RoonApiVolumeControl(roon);
var svc_source_control = new RoonApiSourceControl(roon);

//Populate and validate serial ports
serialportsetup();

roon.init_services({
    provided_services: [ svc_volume_control, svc_source_control, svc_settings, svc_status ]
});

function setup() {
    if (moon.control)
        moon.control.stop();

    moon.control = new Moon();

    moon.control.on('connected', ev_connected);
    moon.control.on('disconnected', ev_disconnected);
    moon.control.on('volume', ev_volume);
    moon.control.on('source', ev_source);

    if (moon.source_control) { moon.source_control.destroy(); delete(moon.source_control); }
    if (moon.volume_control) { moon.volume_control.destroy(); delete(moon.volume_control); }

    var opts = { source: mysettings.setsource };
    if (!mysettings.serialport) {
        svc_status.set_status("Not configured, please check settings.", true);
        return;
    }
    opts.port = mysettings.serialport;
    console.log(opts);
    moon.control.start(opts);
}

function ev_connected(status) {
    let control = moon.control;

    console.log("[Moon Extension] Connected");

    svc_status.set_status("Connected to Moon", false);

    control.set_source(mysettings.setsource);

    moon.volume_control = svc_volume_control.new_device({
	state: {
	    display_name: "Moon",
	    volume_type:  "incremental",
	    is_muted:     control.properties.source == "Muted"
	},
	set_volume: function (req, mode, value) {
	    if (mode == "relative") {
            if (value == 1) {
                control.volume_up();
                // Delay to control the volume steps based on settings
                setTimeout(() => {
                    control.volume_stop();
                }, mysettings.volumesteps);

                req.send_complete("Success");
            }
            else if (value == -1) {
                control.volume_down();
                // Delay to control the volume steps based on settings
                setTimeout(() => {
                    control.volume_stop();
                }, mysettings.volumesteps);

                req.send_complete("Success");
            }
        }
	},
	set_mute: function (req, mode) {
        if (mode == "on") {
			control.mute(2);
		}	
	    else if (mode == "off"){
            control.mute(3);
        }
        else if (mode == "toggle"){
            control.mute();
        }

	    req.send_complete("Success");
	}
    });

    moon.source_control = svc_source_control.new_device({
	state: {
	    display_name:     "Moon Source Control",
	    supports_standby: true,
	    status:           control.properties.source == "Standby" ? "standby" : (control.properties.source == mysettings.setsource ? "selected" : "deselected")
	},
	convenience_switch: function (req) {
		if(this.state.status == "standby") {
            control.power_on();
            this.state.status = "selected";
			control.set_source(mysettings.setsource);
            
            setTimeout(() => {
                control.set_speaker(mysettings.setspeaker);
            }, 150);
            
            req.send_complete("Success");
		}
		else {
            control.set_source(mysettings.setsource);
            
            setTimeout(() => {
                control.set_speaker(mysettings.setspeaker);
            }, 150);

			req.send_complete("Success");
		}
	},
	standby: function (req) {
        control.power_off();
        this.state.status = "standby";
	    req.send_complete("Success");
	}
    });

}

function ev_disconnected(status) {
    let control = moon.control;

    console.log("[Moon Extension] Disconnected");

    svc_status.set_status("Could not connect to Moon on \"" + mysettings.serialport + "\"", true);

    if (moon.source_control) { moon.source_control.destroy(); delete(moon.source_control); }
    if (moon.volume_control) { moon.volume_control.destroy(); delete(moon.volume_control);   }
}

function ev_volume(val) {
    let control = moon.control;
    console.log("[Moon Extension] received volume change from device:", val);
    if (moon.volume_control)
        moon.volume_control.update_state({ volume_value: val });
}
function ev_source(val) {
    let control = moon.control;
    console.log("[Moon Extension] received source change from device:", val);
    if (val == "Muted" && moon.volume_control)
        moon.volume_control.update_state({ is_muted: true });
    else if (val == "UnMuted" && moon.volume_control)
        moon.volume_control.update_state({ is_muted: false });
    else if (val == "standby" && moon.source_control)
        moon.source_control.update_state({ status: "standby" });
    else if (val == "selected" && moon.volume_control)
        moon.source_control.update_state({ status: "selected" });
}

setup();

roon.start_discovery();
