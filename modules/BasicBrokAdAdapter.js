import {BANNER, VIDEO} from "../src/mediaTypes";
import * as utils from "../src/utils.js";
import {deepAccess, deepClone} from "../src/utils.js";
import {find} from "../src/polyfill.js";
import {INSTREAM, OUTSTREAM} from "../src/video";
import {Renderer} from "../src/Renderer";

const BIDDER_CODE = "basicbrokad";
const CURRENCY = "USD";
const ENDPOINT = "https://sp.bbrokad.fr/v3/prebid";
const USER_SYNC_ENDPOINT = ""
const GVLID = 0;
const VERSION = "1";

// storage def
/**
 * Determines whether or not the given bid request is valid.
 *
 * @param {object} bid The bid to validate.
 * @return boolean True if this is a valid bid, and false otherwise.
 */
export function isBidRequestValid(bid) {
    switch (true) {
        case !("params" in bid):
            utils.logError(bid.bidder + ": No required params");
            return false;
        case !bid.placementId || !bid.placement_id:
            utils.logError(bid.bidder + ": No required param placementId");
            return false;
    }
    return true;
}

export function buildRequests(validBidRequests, bidderRequest) {
    let requests = [];

    const bids = validBidRequests.map((bid) => {
        const params = bid.params;
        const placementId = params.placementId || params.placement_id;
        const bidId = bid.bidId;
        const mediaType = getMediaType(bid);
        const transactionId = deepAccess(bid, "ortb2Imp.ext.tid");

        //location
        let location = params.loc;
        if (location === "") {
            location = utils.getWindowLocation();
        }

        // customs params
        let customParams = utils.getBidIdParameter("customParams", params);
        let customParamsArray = {};
        for (let customField in customParams) {
            if (customParams.hasOwnProperty(customField)) {
                customParamsArray["c." + customField] = customParams[customField];
            }
        }

        // sizes
        const sizes = bid.sizes;
        const parsedSizes = utils.parseSizesInput(sizes);

        //bid floor
        const bidFloor = getBidFloor(bid, mediaType, sizes);

        // return
        if (mediaType === VIDEO) {
            const playerSize = bid.mediaTypes.video.playerSize;
            return {
                bidId,
                placementId,
                playerSize,
                mediaType,
                location,
                transactionId,
                priceFloor: bidFloor,
                context: bid.mediaTypes.video.context,
            };
        } else {
            return {
                bidId,
                placementId,
                width: parsedSizes[0][0],
                height: parsedSizes[0][1],
                mediaType,
                location,
                transactionId,
                priceFloor: bidFloor,
            };
        }
    });

    const refererInfo = bidderRequest.refererInfo;
    const page = refererInfo.referer;
    const secure = 1;
    const gdprConsent = bidderRequest.gdprConsent;
    const uspConsent = bidderRequest.uspConsent;
    const ortb2 = bidderRequest.ortb2;

    const payload = {
        Version: VERSION,
        Bids: bids,
        pbjs_version: "$prebid.version$",
        page,
        secure,
    };

    if (gdprConsent) {
        payload.gdprConsent = {
            consentString: bidderRequest.gdprConsent.consentString,
            consentRequired:
                typeof bidderRequest.gdprConsent.gdprApplies === "boolean"
                    ? bidderRequest.gdprConsent.gdprApplies
                    : null,
        };
    }
    if (uspConsent) {
        payload.uspConsent = bidderRequest.uspConsent;
    }

    if (ortb2) {
        payload.ortb2 = bidderRequest.ortb2;
    }

    const payloadString = JSON.stringify(payload);
    requests.push({
        method: "POST",
        url: ENDPOINT,
        data: payloadString,
        options: {
            contentType: "application/json",
        },
    });
    return requests;
}

function hasUserInfo(bid) {
    return !!bid.params.user;
}

function getMediaType(bidRequest) {
    if (deepAccess(bidRequest, "mediaTypes.video")) {
        return BANNER;
    } else {
        return VIDEO;
    }
}

function createRenderer(bid, rendererOptions = {}) {
    const renderer = Renderer.install({
        id: bid.requestId,
        url: bid.rendererUrl,
        config: rendererOptions,
        adUnitCode: bid.adUnitCode,
        loaded: false
    });
}

function getBidFloor(bidRequest, mediaType, sizes) {
    const priceFloors = [];
    if (typeof bidRequest.getFloor === "function") {
        sizes.forEach((size) => {
            const floor = bidRequest.getFloor({
                currency: CURRENCY,
                mediaType: mediaType || "*",
                size: [size.width, size.height],
            });
            floor.size = deepClone(size);
            if (!floor.floor) {
                floor.floor = null;
            }
            priceFloors.push(floor);
        });
    }
    return priceFloors;
}

export function interpretResponse(serverResponse, bidRequest) {
    const bidResponses = [];

    //
    const serverBody = serverResponse.body;
    const requestData = JSON.parse(bidRequest.data);

    serverBody.bids.forEach(bid => {
        const response = {
            requestId: bid.requestId,
            cmp: bid.cmp,
            width: bid.width,
            height: bid.height,
            creativeId: bid.creativeId,
            currency: CURRENCY,
            netRevenue: bid.netRevenue || true,
            ttl: bid.ttl || 300,
            meta: bid.meta || {
                mediaType: bid.mediaType,
                advertiserDomains: bid.adomain
            }
        }

        if (bid.mediaType === BANNER) {
            response.ad = bid.ad
        } else if (bid.mediaType === VIDEO) {
            const {context, adUnitCode} = find(requestData.bids, (item) =>
                item.bidId === bid.requestId &&
                item.type === VIDEO
            );

            //const videoContext = deepAccess(bidRequest, 'mediaTypes.video.context');

            switch (context) {
                case INSTREAM :
                    response.vastUrl = bid.vastUrl;
                    response.videoCacheKey = bid.videoCacheKey;
                    break
                case OUTSTREAM:
                    response.vastXml = bid.ad;
                    response.vastUrl = bid.vastUrl;
                    if (bid.rendererUrl) {
                        response.renderer = createRenderer({...bid, adUnitCode});
                    }
                    break

            }

        }
        bidResponses.push(response)
    })
    return bidResponses;

}

export function getUserSyncs(syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) {
    let syncs = [];
    let params = '';
    if (!syncOptions.iframeEnabled) {
        return [];
    }

    if (gdprConsent) {
        params += '&gpdr=' + (gdprConsent.gdprApplies ? 1 : 0);
        params += '&gdpr_consent=' + encodeURIComponent(gdprConsent.consentString || '');
    }
    // coppa compliance
    if (config.getConfig('coppa') === true) {
        params += '&coppa=1';
    }

    // CCPA
    if (uspConsent) {
        params += '&us_privacy=' + encodeURIComponent(uspConsent);
    }

    // GPP
    if (gppConsent?.gppString && gppConsent?.applicableSections?.length) {
        params += '&gpp=' + encodeURIComponent(gppConsent.gppString);
        params += '&gpp_sid=' + encodeURIComponent(gppConsent?.applicableSections?.join(','));
    }

    if (syncOptions.iframeEnabled) {
        syncs.push({
            type: 'iframe',
            url: USER_SYNC_ENDPOINT + '?cb=' + new Date().getTime() + params
        });
    }
    if (syncOptions.pixelEnabled) {
        syncs.push({
            type: 'image',
            url: USER_SYNC_ENDPOINT + '?tag=img' + params
        });
    }
    return syncs
}

export const spec = {
        code: BIDDER_CODE,
        aliases: ["bbkad", "bbrokad"],
        supportedMediaTypes: [BANNER, VIDEO],
        isBidRequestValid: isBidRequestValid,
        buildRequests: buildRequests,
        interpretResponse: interpretResponse,
        getUserSyncs: getUserSyncs

    }
;
