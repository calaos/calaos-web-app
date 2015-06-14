'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$scope', 'CalaosApp', function ($scope, CalaosApp) {

    $scope.CalaosApp = CalaosApp;
}]);
