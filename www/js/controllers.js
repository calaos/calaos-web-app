'use strict';

/* Controllers */

calaos.controller('MainAppCtrl', function ($scope, CalaosHome, $location) {

    CalaosHome.getSortedHomeByRow().then(function () {},
    function () {
        console.log("go to login page");
        $location.path('/mobile/settings');
    });

    $scope.login = CalaosHome.loginFailed;
    $scope.loading = CalaosHome.loading;

    $scope.$watch( function () { return CalaosHome.loginFailed; }, function ( loginFailed ) {
        $scope.login = loginFailed;
    });

    $scope.$watch( function () { return CalaosHome.loading; }, function ( loading ) {
        $scope.loading = loading;
    });
});

calaos.controller('RoomsListCtrl', function ($scope, CalaosHome, $location) {

    console.log('controller RoomsListCtrl');

    //get the sorted homeByRow from the calaos service
    //and inject that into the controller scope
    CalaosHome.getSortedHomeByRow().then(function (data) {
        $scope.homeByRow = data;
    },
    function() {
        console.log("go to login page");
        $location.path('/mobile/settings');
    });

    CalaosHome.getRawHome().then(function (data) {
        $scope.homeRaw = data;
    });

});

calaos.controller('AudioCtrl', function ($scope, CalaosHome) {

    console.log('controller AudioCtrl');

    $scope.host = calaosConfig.host.substring(0, calaosConfig.host.lastIndexOf('/'));

    CalaosHome.getRawAudio().then(function (data) {
        $scope.audioRaw = data;
        console.log(data);
    });

});

calaos.controller('AudioItemCtrl', function ($scope, CalaosHome, $timeout, $q) {

    console.log('controller AudioItemCtrl');
    var timerPromise = null;
    var canceler = null; //to cancel the request

    $scope.init = function(it) {
        // this is the default image when cover pic is unavailable or
        // something went wrong
        $scope.cover_src = "img/empty.png";

        (function getCoverPic() {
            canceler = $q.defer();
            CalaosHome.getCoverPic(it.player_id, canceler)
                .then(function(d) {
                    if (d.error)
                        $scope.cover_src = "img/empty.png";
                    else
                        $scope.cover_src = "data:" + d.contenttype + ";" + d.encoding + "," + d.data;
                    timerPromise = $timeout(function() {
                        getCoverPic();
                    }, 300);
                });
        })();
    }

    $scope.$on('$locationChangeStart', function() {
        $timeout.cancel(timerPromise);
        canceler.resolve();
    });

});

calaos.controller('AudioPlayerCtrl', function ($scope, $routeParams, CalaosHome, $timeout, $q) {

    console.log('controller AudioPlayerCtrl');

    $scope.setState = function(content, value) {
        CalaosHome.setState(content, value);
    }

    $scope.cover_src = "img/empty.png";
    var timerPromise = null;
    var canceler = null; //to cancel the request

    //get the room from the calaos service
    //and inject that into the controller scope
    CalaosHome.getAudioPlayer($routeParams.player_id).then(function (data) {
        $scope.audioplayer = data;
        $scope.playing = $scope.audioplayer.status == "playing" ? true: false;
        console.log($scope.playing);

        (function getCoverPic() {
            canceler = $q.defer();
            CalaosHome.getCoverPic(data.id, canceler)
                .then(function(d) {
                    if (d.error)
                        $scope.cover_src = "img/empty.png";
                    else
                        $scope.cover_src = "data:" + d.contenttype + ";" + d.encoding + "," + d.data;
                    timerPromise = $timeout(function() {
                        getCoverPic();
                    }, 300);
                });
        })();

    });

    $scope.$on('$locationChangeStart', function() {
        $timeout.cancel(timerPromise);
        canceler.resolve();
    });

});

calaos.controller('CamerasCtrl', function ($scope, CalaosHome) {

    console.log('controller CamerasCtrl');

    CalaosHome.getRawCameras().then(function (data) {
        $scope.camerasRaw = data;
        console.log(data);
    });

});

calaos.controller('CameraItemCtrl', function ($scope, CalaosHome, $timeout, $q, $rootScope) {

    console.log('controller CameraItemCtrl');
    var timerPromise = null;
    var canceler = null;

    $scope.init = function(it) {
        // this is the default image when camera pic is unavailable or
        // something went wrong
        $scope.cam_src = "img/camera_nocam.png";

        (function getCameraPic() {
            canceler = $q.defer();
            CalaosHome.getCameraPic(it.id, canceler)
                .then(function(d) {
                    if (d.error)
                        $scope.cam_src = "img/cam_fail.png";
                    else
                        $scope.cam_src = "data:" + d.contenttype + ";" + d.encoding + "," + d.data;
                    timerPromise = $timeout(function() {
                        getCameraPic();
                    }, 500);
                });
        })();
    }

    $rootScope.$on('$locationChangeStart', function() {
        console.log("$locationChangeStart")
        $timeout.cancel(timerPromise);
        canceler.resolve();
    });

});

calaos.controller('CameraSingleCtrl', function ($scope, CalaosHome, $timeout, $q, $routeParams, $rootScope) {

    console.log('controller CameraItemCtrl');
    var timerPromise = null;
    var canceler = null;
    
    //get the camera from the calaos service
    //and inject that into the controller scope
    CalaosHome.getCamera($routeParams.cam_id).then(function (data) {
        $scope.cam = data;

        // this is the default image when camera pic is unavailable or
        // something went wrong
        $scope.cam_src = "img/camera_nocam.png";

        (function getCameraPic() {
            canceler = $q.defer();
            CalaosHome.getCameraPic($scope.cam.id, canceler)
                .then(function(d) {
                    if (d.error)
                        $scope.cam_src = "img/cam_fail.png";
                    else
                        $scope.cam_src = "data:" + d.contenttype + ";" + d.encoding + "," + d.data;
                    timerPromise = $timeout(function() {
                        getCameraPic();
                    }, 500);
                });
        })();
    });

    $rootScope.$on('$locationChangeStart', function() {
        console.log("$locationChangeStart")
        $timeout.cancel(timerPromise);
        canceler.resolve();
    });

});

calaos.controller('RoomCtrl', function ($scope, $routeParams, CalaosHome) {

    //get the room from the calaos service
    //and inject that into the controller scope
    CalaosHome.getRoom($routeParams.room_name).then(function (data) {
        $scope.room = data;
        console.log($scope.room);
    });

    $scope.getState = function(content) {
        return item.state == 'true'?true:false;
    }

    $scope.getTemplateUrl = function(content) {
        return content.gui_type ;
    }

    $scope.setState = function(content, value) {
        CalaosHome.setState(content, value);
    }
});

calaos.controller('LightCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {
        $scope.state = $scope._item.state == "true"?true:false;
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }
});

calaos.controller('AnalogOutCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {
        $scope.state = parseFloat($scope._item.state);
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }

    $scope.increase = function(it) {
        $scope.setState(it, "inc");
    }

    $scope.decrease = function(it) {
        $scope.setState(it, "dec");
    }

});


calaos.controller('LightDimmerCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {
        $scope.percent_value = 0.0;

        if (!isNaN(parseInt(item.state)))
            $scope.percent_value = parseInt(item.state);
        else if (item.state.substr(0, 4) == "set ")
            $scope.percent_value = parseInt(item.state.substr(4, item.state.length - 4));
        else if (item.state == "true")
            $scope.percent_value = 100;
        else if (item.state == "false")
            $scope.percent_value = 0;

        $scope.state = $scope.percent_value > 0?true:false;
        $scope.name = $scope._item.name;
        $scope.percent_value_rw = $scope.percent_value;
    }

    $scope.changeValueDimmer = function () {
        var s = "set " + $scope.percent_value_rw;
        CalaosHome.setState($scope._item, s);
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }
});

calaos.controller('LightRGBCtrl', function($scope, CalaosHome, $rootScope, ngDialog) {

    var updateState = function (item) {
        
        var toHex = function (c) {
            var hex = c.toString(16);
            return hex.length == 1? "0" + hex : hex;
        };
        
        var col = getRGBValueFromState(item.state);
        
        $scope.color = "#" + toHex(col[0]) + toHex(col[1]) + toHex(col[2]);
        console.log("updateState color: " + $scope.color);

        $scope.state = col[0] > 0 || col[1] > 0 || col[2] > 0?true:false;
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }
    
    $scope.colorPicker = function() {
        console.log("ColorPicker click");
        $rootScope.theme = 'ngdialog-theme-plain';

        ngDialog.open({
			template: 'partials/mobile/color-picker.html',
			controller: 'ColorPickerCtrl',
			className: 'ngdialog-theme-plain',
			closeByDocument: false,
            scope: $scope
        });
    };
});

calaos.controller('StringCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {

        $scope.state = $scope._item.state;
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }

    $scope.setState = function(it, s) {
        console.log("Writing : " + $scope.state);
        CalaosHome.setState(it, $scope.state);
    }

});

calaos.controller('StringInputCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {
        $scope.state = $scope._item.state;
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemInput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }
});

calaos.controller('ShutterCtrl', function ($scope, CalaosHome) {

    var updateState = function (item) {
        $scope.state = parseFloat($scope._item.state);
        $scope.name = $scope._item.name;
    }

    $scope.init = function(it) {
        $scope._item = CalaosHome.getItemOutput(it.id);

        updateState(it);
        $scope.$watch("_item", function() {
            updateState($scope._item);
        }, true);
    }

    $scope.setState = function(it, s) {
        CalaosHome.setState(it, s);
    }
});

calaos.controller('MenuController', function ($scope) {

});

calaos.controller('SettingsCtrl', function ($scope, $window, CalaosHome) {

    if (staticConfig.localhost)
        $scope.localhost = true;

    var tmp = getCookie('cn_user');
    if (tmp) {
        $scope.cn_user = tmp;
    }
    var tmp = getCookie('cn_pass');
    if (tmp) {
        $scope.cn_pass = tmp;
    }
    var tmp = getCookie('use_calaosnetwork');
    if (tmp) {
        if (tmp == "true")
            $scope.use_calaosnetwork = true;
        else
            $scope.use_calaosnetwork = false;
    }

    var tmp = getCookie('host');
    if (tmp) {
        $scope.host = tmp;

    }

    $scope.sign_in = function () {
        setCookie('cn_user', $scope.cn_user, 365);
        setCookie('cn_pass', $scope.cn_pass, 0);
        if (staticConfig.localhost) {
            setCookie('use_calaosnetwork', false, 365);
            calaosConfig.host = location.protocol + '//' + location.hostname + '/api.php';
            setCookie('host', calaosConfig.host, 365);
        }
        else {
            setCookie('use_calaosnetwork', $scope.use_calaosnetwork, 365);
            setCookie('host', $scope.host, 365);
            calaosConfig.host = $scope.host;
        }
        calaosConfig.cn_user = $scope.cn_user;
        calaosConfig.cn_pass = $scope.cn_pass;
        CalaosHome.reset();
        $window.history.back();
    }
});

calaos.controller('ColorPickerCtrl', function ($scope, CalaosHome, ngDialog) {
    
    // Parse hex/rgb{a} color syntax.
    // @input string
    // @returns array [r,g,b{,o}]
    var convertColor = function(color) {

        var cache
          , p = parseInt // Use p as a byte saving reference to parseInt
          , color = color.replace(/\s\s*/g,'') // Remove all spaces
        ;//var

        // Checks for 6 digit hex and converts string to integer
        if (cache = /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})/.exec(color)) 
            cache = [p(cache[1], 16), p(cache[2], 16), p(cache[3], 16)];

        // Checks for 3 digit hex and converts string to integer
        else if (cache = /^#([\da-fA-F])([\da-fA-F])([\da-fA-F])/.exec(color))
            cache = [p(cache[1], 16) * 17, p(cache[2], 16) * 17, p(cache[3], 16) * 17];

        // Checks for rgba and converts string to
        // integer/float using unary + operator to save bytes
        else if (cache = /^rgba\(([\d]+),([\d]+),([\d]+),([\d]+|[\d]*.[\d]+)\)/.exec(color))
            cache = [+cache[1], +cache[2], +cache[3], +cache[4]];

        // Checks for rgb and converts string to
        // integer/float using unary + operator to save bytes
        else if (cache = /^rgb\(([\d]+),([\d]+),([\d]+)\)/.exec(color))
            cache = [+cache[1], +cache[2], +cache[3]];

        // Otherwise throw an exception to make debugging easier
        else throw Error(color + ' is not supported by $.parseColor');

        // Performs RGBA conversion by default
        isNaN(cache[3]) && (cache[3] = 1);

        // Adds or removes 4th value based on rgba support
        // Support is flipped twice to prevent erros if
        // it's not defined
        return cache.slice(0,3 + !!$.support.rgba);
    }
    
    console.log("currentColor: " + $scope.color)
    
    $scope.close = function() {
       ngDialog.close();
    }
    
    $scope.validColor = function() {
        console.log("Valid color clicked");
        ngDialog.close();

        var c = convertColor($scope.color);
        var v = computeStateFromRGBValue(c[0], c[1], c[2]);
        console.log("color: " + c + "   " + v);
        
        CalaosHome.setState($scope._item, "set " + v);
    }
});

calaos.controller('NavBarCtrl', function ($scope, $window) {
    $scope.isCollapsed = true;
    $scope.goHistoryBack = function() {
        $window.history.back();
    };

    document.addEventListener('tizenhwkey', function(e) {
        console.log(e.keyName);
        if(e.keyName == "back")
        {
            //$window.history.back();
            var app = tizen.application.getCurrentApplication();
            app.exit();
        }
    });
});

calaos.controller('MenuCtrl', function ($scope, $window, $location)
{
    $scope.menu = "home";

    $scope.setMenu = function(menu) {

        $scope.menu = menu;
        switch(menu)
        {
        case "home":
            $location.path('/' + getDevice() +'/home');
            break;

        case "audio":
            $location.path('/' + getDevice() +'/audio');
            break;

        case "security":
            $location.path('/' + getDevice() +'/cameras');
            break;
        }
    }
});
