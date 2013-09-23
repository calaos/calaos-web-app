'use strict';

/* Controllers */

calaos.controller('RoomsListCtrl', function ($scope, CalaosHome) {

    console.log('controller RoomsListCtrl');

    //get the sorted homeByRow from the calaos service
    //and inject that into the controller scope
    CalaosHome.getSortedHomeByRow().then(function (data) {
        $scope.homeByRow = data;
    });

    CalaosHome.getRawHome().then(function (data) {
        $scope.homeRaw = data;
    });

    $scope.keyPressed = function(ev) {
        console.log(ev);
        if (ev.which==13)
            alert('Im a lert');
    }
});

calaos.controller('RoomCtrl', function ($scope, $routeParams, CalaosHome) {

    //get the room from the calaos service
    //and inject that into the controller scope
    CalaosHome.getRoom($routeParams.room_name).then(function (data) {
        $scope.room = data;
    });

    $scope.getTemplateUrl = function(content) {
        return content.gui_type ;
    }

    $scope.setState = function(content, value) {
        CalaosHome.setState(content, value);
    }
});

calaos.controller('MenuController', function ($scope) {

});

calaos.controller('SettingsCtrl', function ($scope) {

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
            $scope.use_calaos_network = true;
        else
            $scope.use_calaos_network = false;
    } else  {
        var tmp = getCookie('host');
        if (tmp) {
            $scope.host = tmp;
        }
    }

    $scope.sign_in = function () {
        setCookie('cn_user', $scope.cn_user, 365);
        setCookie('cn_pass', $scope.cn_pass, 0);
        setCookie('use_calaosnetwork', $scope.use_calaosnetwork, 365);
        setCookie('host', $scope.host, 365);
    }
});

calaos.controller('ColorPickerCtrl', function ($scope) {

    console.log($scope.$parent);

    $scope.selectColor = function() {
        console.log("colorPicker click");
    }
});
