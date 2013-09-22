'use strict';

/* Services */

//This is main calaos service
calaos.factory('CalaosHome', ['$http', '$q', '$timeout', function ($http, $q, $timeout) {
    var factory = {};

    //the calaos object will be filled by the data returned
    //by the $http request later. All array are empty at the start
    var calaosObj = null;
    var homeSortedByRow = null;

    var query = {
        "cn_user": calaosConfig.cn_user,
        "cn_pass": calaosConfig.cn_pass,
        "action": "get_home"
    };

    var doInitRequest = function (success_cb, error_cb) {
        $http.post(calaosConfig.host, query)
        .success(function(data) {
            calaosObj = data;

            //sort rooms
            calaosObj.home.sort(function (rooma, roomb) { return roomb.hits - rooma.hits; });

            //create an array of max 3 rooms
            homeSortedByRow = [];
            var a = [];
            for (var i = 0;i < calaosObj.home.length;i++) {
                calaosObj.home[i].icon = getRoomTypeIcon(calaosObj.home[i].type);
                a.push(i);
                if (a.length >= 3) {
                    homeSortedByRow.push(a);
                    a = [];
                }
            }
            if (a.length > 0) homeSortedByRow.push(a);

            success_cb();
        })
        .error(function(data, status) {
            //todo, handle error here
            //but i don't know how yet....

            error_cb();
        });
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
            });
        }

        return deferred.promise;
    };

    return factory;
}]);
