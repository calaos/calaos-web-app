'use strict';

angular.module('calaosApp')
.controller('CameraListCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.camerasRaw = CalaosApp.getHomeData().cameras;

}]);

angular.module('calaosApp')
.controller('CameraItemCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

}]);