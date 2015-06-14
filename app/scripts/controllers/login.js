'use strict';

angular.module('calaosApp')
.controller('LoginCtrl', ['$scope', '$state', 'CalaosApp', function ($scope, $state, CalaosApp) {

    $scope.sign_in = function () {
        CalaosApp.signIn($scope.cn_user, $scope.cn_pass);
    }

}]);
