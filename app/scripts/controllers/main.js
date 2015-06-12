'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$scope', '$location', 'CalaosApp', function ($scope, $location, CalaosApp) {

    $scope.CalaosApp = CalaosApp;
}]);
