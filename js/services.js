'use strict';

var calaosConfig = {
    dev_mode: 'mobile',
}



//This is main calaos service
calaos.factory('CalaosHome', ['$http', '$q', '$timeout', function ($http, $q, $timeout) {
    var factory = {
        loginFailed: false,
        loading: true
    };

    //the calaos object will be filled by the data returned
    //by the $http request later. All array are empty at the start
    var calaosObj = null;
    var homeSortedByRow = null;
    var poll_uuid = null;

    //those are the cache input and output tables
    //they are used to quickly query for an IO without
    //having to look over all rooms
    var inputCache = [];
    var outputCache = [];

    var processCalaosEvent = function (event) {
        if (event == "")
           return;

        console.debug("Received event: ", event);

        var tokens = event.split(" ");

        if (tokens.length < 2) //drop, this is probably not a calaos event
            return;

        //correctly decode the parameters
        for (var i = 0;i < tokens.length;i++) {
            tokens[i] = decodeURIComponent(tokens[i]);
        }

        if (tokens[0] == 'input' ||
            tokens[0] == 'output') {
            var id = tokens[1];

            var tokchange = tokens[2].split(':');
            if (tokchange.length == 2) {
                if (tokens[0] == 'input' && inputCache.hasOwnProperty(tokens[1])) {
                    if (tokchange[0] == 'state')
                        inputCache[tokens[1]].state = tokchange[1];
                    else if (tokchange[0] == 'name')
                        inputCache[tokens[1]].name = tokchange[1];
                    else
                        console.debug('Event change not implemented!');
                }
                else if (tokens[0] == 'output' && outputCache.hasOwnProperty(tokens[1])) {
                    if (tokchange[0] == 'state')
                        outputCache[tokens[1]].state = tokchange[1];
                    else if (tokchange[0] == 'name')
                        outputCache[tokens[1]].name = tokchange[1];
                    else
                        console.debug('Event change not implemented!');
                }
            }
        }
        else {
            //TODO: implement other events here:
            //new_input, new_output
            //delete_input, delete_output
            //modify_room, delete_room, new_room
            //audio_volume, audio_status
            //audio songchanged
            console.debug('Event not implemented!');
        }
    }

    var pollEvents = function () {
        //here we call in a loop the polling for events change in calaos
        if (!poll_uuid)
            return;

        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "poll_listen",
            "uuid": poll_uuid,
            "type": "get"
        };

        $http.post(calaosConfig.host, query)
            .success(function(data) {
                for (var i = 0;i < data.events.length;i++)
                    processCalaosEvent(data.events[i]);
                $timeout(pollEvents, 200);
            });
    }

    var initConfig = function () {

        calaosConfig.cn_user = getCookie('cn_user');
        calaosConfig.cn_pass = getCookie('cn_pass');
        calaosConfig.host = "";
        var tmp = getCookie('use_calaosnetwork');
        if (tmp) {
            if (tmp == "true")
                calaosConfig.use_calaosnetwork = true;
            else
                calaosConfig.use_calaosnetwork = false;
        }

        if (!tmp || calaosConfig.use_calaosnetwork == false) {
            var tmp = getCookie('host');
            if (tmp) {
                calaosConfig.host = tmp;
            }
        }
        if (!calaosConfig.cn_user|| !calaosConfig.cn_pass || !calaosConfig.host)
            return false;
        else
            return true;


    }

    var doInitRequest = function (success_cb, error_cb) {

        if (!initConfig())
            error_cb();

        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "get_home"
        };

        var getHomeReq = function (hostUrl) {
        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "get_home"
        };

        $http.post(hostUrl, query)
        .success(function(data) {
            calaosObj = data;
            //sort rooms
            calaosObj.home.sort(function (rooma, roomb) { return roomb.hits - rooma.hits; });

            //create an array of max 3 rooms
            //and fill cache
            homeSortedByRow = [];
            var a = [];
            for (var i = 0;i < calaosObj.home.length;i++) {
                calaosObj.home[i].icon = getRoomTypeIcon(calaosObj.home[i].type);

                if (calaosObj.home[i].items.inputs)
                for (var io = 0;io < calaosObj.home[i].items.inputs.length;io++) {
                    inputCache[calaosObj.home[i].items.inputs[io].id] = calaosObj.home[i].items.inputs[io];
                }

                if (calaosObj.home[i].items.outputs)
                for (var io = 0;io < calaosObj.home[i].items.outputs.length;io++) {
                    outputCache[calaosObj.home[i].items.outputs[io].id] = calaosObj.home[i].items.outputs[io];
                }

                a.push(i);
                if (a.length >= 3) {
                    homeSortedByRow.push(a);
                    a = [];
                }
            }
            if (a.length > 0) homeSortedByRow.push(a);

            factory.loginFailed = false;
            console.log("login failed: " + factory.loginFailed);

            success_cb();
        })
        .error(function(data, status) {
            if (status === 401) //login failed
            {
                factory.loginFailed = true;
                console.log("login failed: " + factory.loginFailed);
            }
            factory.loading = false;
            error_cb();
        }).then(function (value) {
            factory.loading = false;
            var q = {
                "cn_user": calaosConfig.cn_user,
                "cn_pass": calaosConfig.cn_pass,
                "action": "poll_listen",
                "type": "register"
            };
            $http.post(calaosConfig.host, q).
                success(function(data) {
                    poll_uuid = data['uuid'];
                    $timeout(pollEvents, 1000);
                });
        });
        }

        if (calaosConfig.use_calaosnetwork) {
            $http.post('https://calaos.fr/calaos_network/api.php', {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "get_ip"
            }).then(function(data) {
                var h;
                if (data.data.at_home)
                    h = 'https://' + data.data.private_ip + '/api.php';
                else
                    h = 'https://' + data.data.public_ip + '/api.php';
                calaosConfig.host = h;
                getHomeReq(h);
            }, function () {
                factory.loginFailed = true;
                factory.loading = false;
                console.log("get_ip: login failed: " + factory.loginFailed);
            });
        }
        else {
            var h = calaosConfig.host;
            if (h.substr(0, 4) != 'http')
                h = 'https://' + h + '/api.php';
            calaosConfig.host = h;
            getHomeReq(h);
        }

    };

    //returns the home sorted by 3 rows, this is used to have row of 3 rooms
    factory.getSortedHomeByRow = function () {
        var deferred = $q.defer();

        if (homeSortedByRow)
            deferred.resolve(homeSortedByRow);
        else
            doInitRequest(function () {
                deferred.resolve(homeSortedByRow);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };

    //returns the raw home data as returned by the request
    factory.getRawHome = function () {
        var deferred = $q.defer();

        if (calaosObj)
            deferred.resolve(calaosObj.home);
        else
            doInitRequest(function () {
                deferred.resolve(calaosObj.home);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };

    //returns the raw audio data as returned by the request
    factory.getRawAudio = function () {
        var deferred = $q.defer();

        if (calaosObj)
            deferred.resolve(calaosObj.audio);
        else
            doInitRequest(function () {
                deferred.resolve(calaosObj.audio);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };

    //returns the raw cameras data as returned by the request
    factory.getRawCameras = function () {
        var deferred = $q.defer();

        if (calaosObj)
            deferred.resolve(calaosObj.cameras);
        else
            doInitRequest(function () {
                deferred.resolve(calaosObj.cameras);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };

    //returns the room by its name
    factory.getRoom = function (name) {
        var deferred = $q.defer();
        if (calaosObj) {
            var room = {};
            for(var i = 0;i < calaosObj.home.length; i++) {
                if (calaosObj.home[i].name == name) {
                    room = calaosObj.home[i];
                    break;
                }
            }
            deferred.resolve(room);
        }
        else {
            doInitRequest(function () {
                var room = {};
                for(var i = 0;i < calaosObj.home.length; i++) {
                    if (calaosObj.home[i].name == name) {
                        room = calaosObj.home[i];
                        break;
                    }
                }
                deferred.resolve(room);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });
        }

        return deferred.promise;
    };

    //returns the audioplayer by its name
    factory.getAudioPlayer = function (pid) {
        var deferred = $q.defer();
        if (calaosObj) {
            var audioplayer = {};
            for(var i = 0;i < calaosObj.audio.length; i++) {
                if (calaosObj.audio[i].player_id == pid) {
                    audioplayer = calaosObj.audio[i];
                    break;
                }
            }
            deferred.resolve(audioplayer);
        }
        else {
            doInitRequest(function () {
                var audioplayer = {};
                for(var i = 0;i < calaosObj.audio.length; i++) {
                    if (calaosObj.audio[i].player_id == pid) {
                        audioplayer = calaosObj.audio[i];
                        break;
                    }
                }
                deferred.resolve(audioplayer);
            }, function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });
        }

        return deferred.promise;
    };

    factory.getCameraPic = function (camid, canceler) {
        var deferred = $q.defer();
        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "get_camera_pic",
            "camera_id": camid
        };

        console.debug(query);

        $http.post(calaosConfig.host, query, {timeout: canceler.promise})
            .success(function(data) {
                deferred.resolve(data);
                console.log(data);
            })
            .error(function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };

    factory.getCoverPic = function (pid, canceler) {
        var deferred = $q.defer();
        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "get_cover",
            "player_id": pid
        };

        console.debug(query);

        $http.post(calaosConfig.host, query, {timeout: canceler.promise})
            .success(function(data) {
                deferred.resolve(data);
                console.log(data);
            })
            .error(function () {
                console.log("error in http request");
                deferred.reject('error in request');
            });

        return deferred.promise;
    };


    factory.setState = function (content, value) {
        var query = {
            "cn_user": calaosConfig.cn_user,
            "cn_pass": calaosConfig.cn_pass,
            "action": "set_state",
            "type": "output",
            "id": content.id,
            "value": value
        };

        console.log("setState: " + query.value);

        $http.post(calaosConfig.host, query)
            .success(function(data) {
                console.log("Set state success");
            })
            .error(function(data, status) {
                console.log("error in http request");
                deferred.reject('error in request');
            });
    };

    //get an io from the cache
    factory.getItemInput = function (id) {
        return inputCache[id];
    }

    //get an io from the cache
    factory.getItemOutput = function (id) {
        return outputCache[id];
    }

    //reset Calaos main object (after user/pass changed for example)
    factory.reset = function() {
        calaosObj = null;
        homeSortedByRow = null;
        inputCache = [];
        outputCache = [];
        poll_uuid = null;
        factory.loading = true;
    }
    return factory;
}]);
