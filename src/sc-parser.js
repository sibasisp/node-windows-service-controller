var _ = require('lodash'),
    escapeRegex = require('escape-string-regexp');

_.mixin(require('underscore.string').exports());

function getNameValueRegex(name, value, flags) {
    return new RegExp(escapeRegex(name) + '\\s*[=:]' + value, flags);
}

function matchGroupOrDefault(source, regex, defaultValue) {
    var result = source.match(regex);
    return result && result.length > 1 ? _.trim(result[1]) : defaultValue;
}

function getValue(source, name, defaultValue) {
    return matchGroupOrDefault(source,
        getNameValueRegex(name, '(.*)'), defaultValue);
}

function getCodeNameValue(source, name, defaultValue) {
    return matchGroupOrDefault(source,
        getNameValueRegex(name, '\\s*\\d*\\s*(.*)'), defaultValue);
}

function getFlags(source, name) {
    return matchGroupOrDefault(source,
        new RegExp(escapeRegex(name) + '\\s*:\\s.*\\s*\\((.*)\\)'));
}

function getArrayValue(source, name) {
    source = matchGroupOrDefault(source,
        new RegExp(escapeRegex(name) + '((\\s*:.*)*)'));
    if (!source) return [];
    var regex = /\s*:\s*(.*)/g;
    var results = [];
    var match;
    while (match = regex.exec(source)) {
        if (match[1]) results.push(match[1]);
    }
    return results;
}

function getNumericValue(source, name, hex, defaultValue) {
    var value = matchGroupOrDefault(source,
        getNameValueRegex(name, '\\s*((0x)?\\d*)'), defaultValue);
    if (hex && !_.startsWith('0x')) value = '0x' + value;
    return parseInt(value);
}

function getHexValue(source, name, defaultValue) {
    return parseInt(getValue(source, name, defaultValue));
}

function getBooleanValue(source, name, defaultValue) {
    return Boolean(matchGroupOrDefault(source,
        getNameValueRegex(name, '\\s*(true|false)', 'i'), defaultValue));
}

exports.error = function(output) {
    var result = getValue(output, 'ERROR') ||
        matchGroupOrDefault(output, /^\[SC\].*\s*(.*)/);
    return result || output;
};

exports.displayName = function(output) {
    return getValue(output, 'Name', output);
};

exports.keyName = function(output) {
    return getValue(output, 'Name', output);
};

exports.description = function(output) {
    return getValue(output, 'DESCRIPTION', output);
};

exports.descriptor = function(output) {
    return matchGroupOrDefault(output, /\s*(.*)\s*/, output);
};

exports.lock = function(output) {
    return {
        locked: getBooleanValue(output, 'IsLocked', false),
        owner: getValue(output, 'LockOwner', ''),
        duration: getNumericValue(output, 'LockDuration', false, 0)
    };
};

exports.failureConfig = function(output) {
    return {
        resetPeriod: getNumericValue(output, 'RESET_PERIOD (in seconds)', false, 0),
        rebootMessage: getValue(output, 'REBOOT_MESSAGE', ''),
        commandLine: getValue(output, 'COMMAND_LINE', ''),
        failureActions: getValue(output, 'FAILURE_ACTIONS', '')
    };
};

exports.config = function(output) {
    return {
        type: {
            code: getNumericValue(output, 'TYPE', true, 0),
            name: getCodeNameValue(output, 'TYPE', '')
        },
        startType: {
            code: getNumericValue(output, 'START_TYPE', true, 0),
            name: getCodeNameValue(output, 'START_TYPE', '')
        },
        errorControl: {
            code: getNumericValue(output, 'ERROR_CONTROL', true, 0),
            name: getCodeNameValue(output, 'ERROR_CONTROL', '')
        },
        binPath: getValue(output, 'BINARY_PATH_NAME', ''),
        loadOrderGroup: getValue(output, 'LOAD_ORDER_GROUP', ''),
        tag: getNumericValue(output, 'TAG', false, 0),
        displayName: getValue(output, 'DISPLAY_NAME', ''),
        dependencies: getArrayValue(output, 'DEPENDENCIES'),
        serviceStartName: getValue(output, 'SERVICE_START_NAME', '')
    };
};

exports.services = function(output) {
    var services = output.split(/\r?\n\r?\n/)
        .filter(function(output) { return /SERVICE_NAME/.test(output); })
        .map(function(output) {
            var state = getNumericValue(output, 'STATE', true, 0);
            var service = {
                name: getValue(output, 'SERVICE_NAME', ''),
                displayName: getValue(output, 'DISPLAY_NAME', ''),
                type: {
                    code: getNumericValue(output, 'TYPE', true, 0),
                    name: getCodeNameValue(output, 'TYPE', '')
                },
                state: {
                    code: state,
                    name: getCodeNameValue(output, 'STATE', ''),
                    running: state === 4,
                    paused: state === 7,
                    stopped: state === 1
                },
                win32ExitCode: getNumericValue(output, 'WIN32_EXIT_CODE', false, 0),
                serviceExitCode: getNumericValue(output, 'SERVICE_EXIT_CODE', false, 0),
                checkpoint: getHexValue(output, 'CHECKPOINT', 0),
                waitHint: getHexValue(output, 'WAIT_HINT', 0)
            };
            var accepted = getFlags(output, 'STATE');
            var pid = getNumericValue(output, 'PID', false, null);
            var flags = getValue(output, 'FLAGS', null);
            if (accepted) service.accepted = accepted.split(', ');
            if (pid) service.pid = pid;
            if (flags) service.flags = flags;
            return service;
        });

    //var services = [];

    //This code will handle non-english OS's
    var types = ["KERNEL_DRIVER", "FILE_SYSTEM_DRIVER", "WIN32_OWN_PROCESS", "WIN32_SHARE_PROCESS", "INTERACTIVE_PROCESS"];
    var states = ["STOPPED", "START_PENDING", "STOP_PENDING", "RUNNING", "CONTINUE_PENDING", "PAUSE_PENDING", "PAUSED"];
    if (services.length === 0){
        services = [];
        output =  output.split(/\r?\n\r?\n/);
        output.forEach(function(out) {
            var service = {};
            var outLines = out.split('\n');
            var foundName = false;
            for(var line in  outLines) {
                line = outLines[line];
                var l = line.trim().split(":");
                if (line.trim().length === 0 || line.startsWith("[SC]")){
                    continue;
                }
                if (!foundName) {
                    service.name = l[1].trim();
                    foundName = true;
                }
                if (l.length > 1 && l[0].trim().toLowerCase() === 'PID'.toLowerCase()) {
                    service.pid = l[1].trim();
                    break;
                }
                for (var type in types){
                    type = types[type]
                    if (l.length > 1 && l[1].trim().indexOf(type) !== -1){
                        var lineVal = l[1].split(" ");
                        for (var i = 0 ; i < lineVal.length ; i++){
                            if (lineVal[i].trim().length === 0){
                                lineVal.splice(i, 1);
                            }
                        }
                        service.type =  {};
                        service.type.code = lineVal[0].trim();
                        service.type.name = lineVal[1].trim();
                        break;
                    }
                }
                for (var state in states){
                    state = states[state];
                    if (l.length > 1 && l[1].trim().indexOf(state) !== -1){
                        var lineVal = l[1].split(" ");
                        for (var i = 0 ; i < lineVal.length ; i++){
                            if (lineVal[i].trim().length === 0){
                                lineVal.splice(i, 1);
                            }
                        }
                        service.state =  {};
                        service.state.code = lineVal[0].trim();
                        service.state.name = lineVal[1].trim();
                        service.state.running =  service.state.code === '4';
                        service.state.paused =  service.state.code === '7';
                        service.state.stopped =  service.state.code === '1';
                        break;
                    }
                }

            }
            if (service.name !== undefined && service.name.length > 0) {
                services.push(service);
            }
        });
    }
    return services;
};