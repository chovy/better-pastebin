var cheerio = require("cheerio"),
    request = require("request"),
    xml2js = require("xml2js"),
    fs = require("fs"),
    jar = request.jar(),
    api = {
        urls: {
            prelogin: 'http://pastebin.com/login',
            login: "http://pastebin.com/login.php",
            apilogin: "http://pastebin.com/api/api_login.php",
            raw: "http://pastebin.com/raw.php?i=",
            edit: "http://pastebin.com/edit",
            post: "http://pastebin.com/api/api_post.php"
        }
    },
    csrf_token,
    pbapi;

pbapi = {
    setDevKey: function(devkey) {
        pbapi.devkey = devkey;
    },

    login: function(username, password, cb) {
        var both = 0;

        function done() {
            both++;
            if(both === 2) {
                if(cb) { cb(true, pbapi.userkey); }
            }
        }

        request({
            method: "POST",
            url: api.urls.apilogin,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_user_name: username,
                api_user_password: password
            }
        }, function(err, res, data) {
            if(data === "Bad API request, invalid api_dev_key") {
                if(cb) { cb(false, new Error("Invalid devkey")); }
            } else {
                pbapi.userkey = data;
                done();
            }
        });

        request({
          method: 'GET',
          url: api.urls.prelogin,
          jar: jar,
        }, function(err, res, data){
          var $ = cheerio.load(data);
          csrf_token = $('input[name=csrf_token_login]').val();

          request({
            method: "POST",
            url: api.urls.login,
            jar: jar,
            followAllRedirects: true,
            form: {
              csrf_token_login: csrf_token,
              submit_hidden: "submit_hidden",
              user_name: username,
              user_password: password,
              submit:'Login'
            }
          }, function(err, res, data) {
            done();
          });
        });
    },

    get: function(paste, cb) {
        request({
            method: "GET",
            url: api.urls.raw + paste,
            jar: jar
        }, function(err, res, data) {
            var $;

            //Check if the page is HTML instead of plain text
            if(res.headers["content-type"] === "text/html; charset=utf-8") {
                $ = cheerio.load(data);

                if($(".content_title").html() === "This paste has been removed!") {
                    if(cb) { cb(false, new Error("Paste is deleted")); }
                }

                return false;
            }

            if(data === "Error, this is a private paste. If this is your private paste, please login to Pastebin first.") {
                if(cb) { cb(false, new Error("Paste is private")); }
                return false;
            }

            if(cb) { cb(true, data); }
        });
    },

    edit: function(paste, options, cb) {
        request({
            method: "GET",
            url: api.urls.edit + "?i=" + paste,
            jar: jar
        }, function(err, res, data) {
            var $ = cheerio.load(data);
            var title = $("title").html();
            var pasteformat = $("#myform select[name=paste_format]").val();
            var pasteprivate = $("#myform select[name=paste_private]").val();
            var postkey = $("#myform input[name=item_key]").val();
            var pastename = $("#myform input[name=paste_name]").val();

            if(typeof options === "string") {
                options = { contents: options }
            }

            var postData = {
              submit_hidden: "submit_hidden",
              item_key: paste,
              post_key: postkey,
              paste_code: options.contents,
              paste_expire_date: options.expires || "DNC",
              paste_format: options.format || pasteformat,
              paste_private: options.privacy || pasteprivate,
              paste_name: options.name || pastename
            };

            postData['csrf_token_'+paste] = csrf_token;

            request({
                method: "POST",
                url: api.urls.edit+'/'+paste,
                jar: jar,
                form: postData,
                followAllRedirects: true
            }, function(err, res, data) {
                if(cb) { cb(true, options.contents); }
            });
        });
    },

    create: function(options, cb) {
        if(typeof options === "string") {
            options = { contents: options };
        }

        if(!options.contents) {
            if(cb) { cb(false, new Error("No content supplied")); }
            return false;
        }

        request({
            method: "POST",
            url: api.urls.post,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_user_key: options.anonymous ? "" : (pbapi.userkey || ""),
                api_paste_code: options.contents,
                api_paste_expire_date: options.expires || "N",
                api_paste_format: options.format || "text",
                api_paste_private: options.privacy || "0",
                api_paste_name: options.name || "",
                api_option: "paste"
            }
        }, function(err, res, data) {
            if(data === "Bad API request, invalid api_dev_key") {
                if(cb) { cb(false, new Error("Invalid devkey")); }
            } else if(data === "Bad API request, api_paste_code was empty") {
                if(cb) { cb(false, new Error("No content supplied")); }
            } else {
                if(cb) { cb(true, data); }
            }
        });
    },

    createFromFile: function(options, cb) {
        if(typeof options === "string") {
            options = { path: options };
        }

        if(!options.encoding) {
            options.encoding = "utf8";
        }

        fs.readFile(options.path, options.encoding, function(err, data) {
            if(err) {
                if(cb) { cb(false, err); }
            } else {
                options.contents = data;
                pbapi.create(options, cb);
            }
        });
    },

    list: function(limit, cb) {
        if(typeof limit === "function") {
            cb = limit;
            limit = 50;
        }

        if(!pbapi.userkey) {
            if(cb) { cb(false, new Error("Action requires login")); }
            return false;
        }

        request({
            method: "POST",
            url: api.urls.post,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_user_key: pbapi.userkey,
                api_results_limit: limit,
                api_option: "list"
            }
        }, function(err, res, data) {
            if(data === "No pastes found.") {
                if(cb) { cb(true, []); }
            }

            data = "<output>" + data + "</output>";

            xml2js.parseString(data, function(err, result) {
                if(cb) { cb(true, result.output.paste); }
            });
        });
    },

    listTrending: function(cb) {
        request({
            method: "POST",
            url: api.urls.post,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_option: "trends"
            }
        }, function(err, res, data) {
            data = "<output>" + data + "</output>";

            xml2js.parseString(data, function(err, result) {
                if(cb) { cb(true, result.output.paste); }
            });
        });
    },

    delete: function(paste, cb) {
        request({
            method: "POST",
            url: api.urls.post,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_user_key: pbapi.userkey,
                api_paste_key: paste,
                api_option: "delete"
            }
        }, function(err, res, data) {
            if(data === "Paste Removed") {
                if(cb) { cb(true, paste); }
            } else {
                if(cb) { cb(true, data); }
            }
        });
    },

    user: function(cb) {
        request({
            method: "POST",
            url: api.urls.post,
            jar: jar,
            form: {
                api_dev_key: pbapi.devkey,
                api_user_key: pbapi.userkey,
                api_option: "userdetails"
            }
        }, function(err, res, data) {
            xml2js.parseString(data, function(err, result) {
                if(cb) { cb(true, result.user); }
            });
        });
    }
};

module.exports = pbapi;
