var gulp = require('gulp'),
    gutil = require('gulp-util'),
    usemin = require('gulp-usemin'),
    uglify = require('gulp-uglify-es').default,
    minifyCss = require('gulp-minify-css'),
    connect = require('gulp-connect'),
    imagemin = require('gulp-imagemin'),
    cache = require('gulp-cache'),
    minifyHtml = require('gulp-minify-html'),
    rev = require('gulp-rev'),
    concat = require('gulp-concat'),
    opn = require('opn'),
    ngAnnotate = require('gulp-ng-annotate'),
    jsonminify = require('gulp-jsonminify'),
    file = require('gulp-file'),
    debug = require('gulp-debug'),
    grename = require('gulp-rename'),
    filelist = require('gulp-filelist'),
    del = require('del');

gulp.task('views', function () {
    return gulp.src('src/views/**/*.html')
        .pipe(minifyHtml({empty: true}))
        .pipe(gulp.dest('dist/views'));
});

gulp.task('usemin', function() {

    return gulp.src('src/*.html')
        .pipe(usemin({
            css: [minifyCss({
                advanced: false
            }), 'concat'],
            html: [minifyHtml({empty: true})],
//            js: [uglify({mangle: false})],
            js: [ngAnnotate(), uglify()],
            jsoldie: [uglify()],
            jsvendor: [uglify()],
            inlinejs: [uglify()],
            inlinecss: [minifyCss(), 'concat']
        }))
        .pipe(gulp.dest('dist'));
});

gulp.task('images', function () {
    return gulp.src('src/images/**/*')
  //      .pipe(cache(imagemin({ optimizationLevel: 3, progressive: true, interlaced: true })))
        .pipe(debug({title: 'image:'}))
        .pipe(gulp.dest('dist/images'));
});

gulp.task('fonts', function () {
    return gulp.src([
        'src/fonts/Source_Sans_Pro/fonts/**/*',
        'src/fonts/Ubuntu/fonts/**/*'])
        .pipe(gulp.dest('dist/fonts'));
});

gulp.task('webfonts', function () {
    return gulp.src([
        'src/bower_components/font-awesome/web-fonts-with-css/webfonts/**/*'])
        .pipe(gulp.dest('dist/webfonts'));
});

gulp.task('reload', function () {
  return gulp.src('src/**/**.*')
    .pipe(gulp.dest('./src'))
    .pipe(connect.reload());
});

gulp.task('connect', function (done) {
  connect.server({
    root: 'src',
    port: 8000
//    livereload: true
  });
//  opn('http://localhost:8000', done);
});

gulp.task('watch', function () {
  gulp.watch(['src/**/**.js', 'src/**/**.png', 'src/**/**.html', 'src/**/**.css'], ['reload']);
});

gulp.task('clean', function () {
    return del(['dist']);
});

gulp.task('devjs', function (cb) {
    //create a correct dev_config.js file for deployment
    return file('dev_config.js', "var calaosDevConfig = { calaosServerHost: '' };")
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('piclist', function (cb) {
    return gulp.src(['src/images/**/*'])
        .pipe(grename(function (path) { path.dirname = 'images';  }))
        .pipe(filelist('assets.json', { relative: true }))
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('piclist-dev', function (cb) {
    return gulp.src(['src/images/**/*'])
        .pipe(grename(function (path) { path.dirname = 'images';  }))
        .pipe(filelist('assets.json', { relative: true }))
        .pipe(gulp.dest('src/scripts'));
});

//gulp.task('serve', ['connect', 'watch']);
gulp.task('serve', ['piclist-dev', 'connect']);
gulp.task('build', ['usemin', 'images', 'fonts', 'webfonts', 'views', 'devjs', 'piclist']);

gulp.task('default', ['clean'], function () {
    gulp.start('build');
});
