'use strict';

angular.module('calaosApp')
.controller('CameraListCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.cameraSorted = CalaosApp.getSortedCameraByRow();
    $scope.cameras = CalaosApp.getHomeData().cameras;
}]);

angular.module('calaosApp')
.controller('CameraSingleCtrl', ['$scope', '$state', '$stateParams', 'CalaosApp', '$timeout', function ($scope, $state, $stateParams, CalaosApp, $timeout) {

    $scope.cameras = CalaosApp.getHomeData().cameras;

    if ($stateParams.cameraId < 0 || $stateParams.cameraId >= $scope.cameras.length) {
        console.log('unkown camera ' + $stateParams.cameraId);
        $state.go('security.list');
    }
    else {
        $scope.camera = $scope.cameras[$stateParams.cameraId];
    }

}]);
