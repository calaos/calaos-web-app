'use strict';

/* Controllers */

calaos.controller('MainAppCtrl', function ($scope, CalaosHome, $location) {

    CalaosHome.getSortedHomeByRow().then(function () {},
    function () {
        console.log("go to login page");
        $location.path('/' + getDevice() + '/settings');
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
        $location.path('/' + getDevice() + '/settings');
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
            CalaosHome.getCoverPic(data.player_id, canceler)
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

calaos.controller('CameraItemCtrl', function ($scope, CalaosHome, $timeout, $q) {

    console.log('controller CameraItemCtrl');
    var timerPromise = null;
    var canceler = null;

    $scope.init = function(it) {
        // this is the default image when camera pic is unavailable or
        // something went wrong
        $scope.cam_src = "img/cam_fail.png";

        (function getCameraPic() {
            canceler = $q.defer();
            CalaosHome.getCameraPic(it.camera_id, canceler)
                .then(function(d) {
                    if (d.error)
                        $scope.cam_src = "img/cam_fail.png";
                    else
                        $scope.cam_src = "data:" + d.contenttype + ";" + d.encoding + "," + d.data;
                    $timeout(function() {
                        getCameraPic();
                    }, 300);
                });
        })();
    }

    $scope.$on('$locationChangeStart', function() {
        $timeout.cancel(timerPromise);
        canceler.resolve();
    });

});

calaos.controller('RoomCtrl', function ($scope, $routeParams, CalaosHome) {

    //get the room from the calaos service
    //and inject that into the controller scope
    CalaosHome.getRoom($routeParams.room_name).then(function (data) {
        $scope.room = data;
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

calaos.controller('LightRGBCtrl', ['$scope', 'createDialog', function($scope, createDialogService) {

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

    $scope.colorPicker = function() {
        console.log("ColorPicker click");

        createDialogService('partials/mobile/color-picker.html', {
                                id: 'simpleDialog',
                                title: 'Choose a color',
                                backdrop: true,
                                css: {
                                  margin: '0 auto'
                                },
                                success: {label: 'Success', fn: function() {console.log('Simple modal closed');}}
                            });


    };
}]);

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
});


calaos.controller('MenuController', function ($scope) {

});

calaos.controller('SettingsCtrl', function ($scope, $window, CalaosHome) {

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
        setCookie('use_calaosnetwork', $scope.use_calaosnetwork, 365);
        setCookie('host', $scope.host, 365);
        calaosConfig.cn_user = $scope.cn_user;
        calaosConfig.cn_pass = $scope.cn_pass;
        calaosConfig.host = $scope.host;
        CalaosHome.reset();
        $window.history.back();
    }
});

calaos.controller('ColorPickerCtrl', function ($scope, $routeParams) {

    $scope.color = $routeParams.color;
    document.getElementById("color").style.backgroundColor = $scope.color;

    var convertColor = function (color) {
        var tmp = /(.*?)rgb\((\d+), (\d+), (\d+)\)/.exec(color);

        var red = parseInt(tmp[2]);
        var green = parseInt(tmp[3]);
        var blue = parseInt(tmp[4]);

        return blue | (green << 8) | (red << 16);

    }

    $scope.selectColor = function() {
        $scope.color = convertColor(document.getElementById("color").style.backgroundColor);
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
            var deviceCapabilities;
            deviceCapabilities = tizen.systeminfo.getCapabilities();
            console.log(deviceCapabilities)
            if (deviceCapabilities.bluetooth)
            {
                console.log("Bluetooth is supported");
            }
            $window.history.back();
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
            $location.path('/mobile/home');
            break;

        case "audio":
            $location.path('/mobile/audio');
            break;

        case "security":
            $location.path('/mobile/cameras');
            break;
        }
    }
});
