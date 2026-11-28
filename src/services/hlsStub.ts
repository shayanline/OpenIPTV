/**
 * What `import("hls.js")` resolves to in a production build, where the library is loaded from
 * its own file instead (see services/hlsLoader). Without this the classic bundle would inline
 * the whole library into the script every television parses at launch.
 */
export default undefined;
