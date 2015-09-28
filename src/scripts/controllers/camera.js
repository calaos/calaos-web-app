'use strict';

angular.module('calaosApp')
.controller('CameraListCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.cameraSorted = CalaosApp.getSortedCameraByRow();
    $scope.cameras = CalaosApp.getHomeData().cameras;
}]);

angular.module('calaosApp')
.controller('CameraItemCtrl', ['$scope', '$state', 'CalaosApp', '$timeout', function ($scope, $state, CalaosApp, $timeout) {

    $scope.camera_reloader = function (camid) {
        $scope.updater = function () {
            $scope.cam_url = $scope.cameras[camid].cam_src + '&' + new Date().getTime();
            $timeout($scope.updater, 1000);
        }
        $scope.updater();
    };

}]);

angular.module('calaosApp')
.controller('CameraSingleCtrl', ['$scope', '$state', '$stateParams', 'CalaosApp', '$timeout', function ($scope, $state, $stateParams, CalaosApp, $timeout) {

    $scope.cameras = CalaosApp.getHomeData().cameras;

    var camera_reloader = function (camid) {
        $scope.updater = function () {
            $scope.cam_url = $scope.cameras[camid].cam_src + '&' + new Date().getTime();
            $timeout($scope.updater, 1000);
        }
        $scope.updater();
    };

    if ($stateParams.cameraId < 0 || $stateParams.cameraId >= $scope.cameras.length) {
        console.log('unkown camera ' + $stateParams.cameraId);
        $state.go('security.list');
    }
    else {
        $scope.camera = $scope.cameras[$stateParams.cameraId];
        camera_reloader($stateParams.cameraId);
    }

}]);
